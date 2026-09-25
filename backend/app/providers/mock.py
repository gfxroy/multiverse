"""A deterministic fake language model that produces plausible top-k logprobs.

It is a word-level trigram/bigram model over a small built-in corpus with prompt-keyword
boosting and hash-based "personality" noise per model name. Everything is derived from
SHA-256 hashes of the request, so identical requests always produce identical output, and
forcing a different token genuinely changes what comes next. This lets the whole app run
end-to-end with no API key.
"""

from __future__ import annotations

import asyncio
import hashlib
import math
import random
import re
from collections import Counter, defaultdict

from ..entropy import annotate_token, build_alternatives
from ..schemas import GenerationSettings, ProviderResult, TokenInfo
from .mock_corpus import TOPICS

_TOKEN_RE = re.compile(r"\w+|[^\w\s]")
_START = "<s>"
_SENTENCE_END = {".", "!", "?"}
_NO_SPACE_BEFORE = {".", ",", "!", "?", ":", ";"}


def tokenize(text: str) -> list[str]:
    """Split text into word/punctuation tokens with GPT-style leading spaces."""
    tokens: list[str] = []
    for match in _TOKEN_RE.finditer(text):
        word = match.group(0)
        if word in _NO_SPACE_BEFORE or (not tokens and match.start() == 0):
            tokens.append(word)
        else:
            tokens.append(" " + word)
    return tokens


def _key(token: str) -> str:
    return token.strip().lower()


def _unit_hash(*parts: str) -> float:
    """Deterministic pseudo-random number in [-1, 1] derived from the given strings."""
    digest = hashlib.sha256("\x1f".join(parts).encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2**63 - 1.0


class _NGramModel:
    def __init__(self) -> None:
        self.bigram: dict[str, Counter[str]] = defaultdict(Counter)
        self.trigram: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
        self.unigram: Counter[str] = Counter()
        self.topic_vocab: dict[str, set[str]] = {}
        for topic, (_, text) in TOPICS.items():
            vocab: set[str] = set()
            for sentence in re.split(r"(?<=[.!?])\s+", text):
                toks = tokenize(sentence)
                if not toks:
                    continue
                # Sentence starts get a leading space so they can follow a period mid-text.
                toks = [t if t.startswith(" ") or t in _NO_SPACE_BEFORE else " " + t for t in toks]
                ctx = [_START, _START]
                for tok in toks:
                    self.trigram[(_key(ctx[-2]), _key(ctx[-1]))][tok] += 1
                    self.bigram[_key(ctx[-1])][tok] += 1
                    self.unigram[tok] += 1
                    vocab.add(tok)
                    ctx.append(tok)
                    if tok in _SENTENCE_END:
                        ctx = [_START, _START]
            self.topic_vocab[topic] = vocab
        self.common = [t for t, _ in self.unigram.most_common(60)]

    def candidates(self, context: list[str]) -> dict[str, float]:
        """Raw evidence (pseudo-counts) for each candidate next token."""
        prev2 = _key(context[-2]) if len(context) >= 2 else _START
        prev1 = _key(context[-1]) if context else _START
        if context and context[-1] in _SENTENCE_END:
            prev2, prev1 = _START, _START
        scores: dict[str, float] = defaultdict(float)
        for tok, c in self.trigram.get((prev2, prev1), Counter()).items():
            scores[tok] += 4.0 * c
        for tok, c in self.bigram.get(prev1, Counter()).items():
            scores[tok] += 0.6 * c
        if prev1 == _START:
            for tok, c in self.bigram[_START].items():
                scores[tok] += 0.5 * c
        # Back-off: a few common tokens always get a little mass so top-k is well populated.
        for tok in self.common:
            scores[tok] += 0.003 * self.unigram[tok]
        return dict(scores)


_MODEL = _NGramModel()


class MockProvider:
    """Demo-mode provider. ``latency`` adds an artificial delay so the UI feels realistic."""

    name = "mock"

    def __init__(self, latency: float = 0.0) -> None:
        self.latency = latency

    @staticmethod
    def _topics_for(prompt: str) -> list[str]:
        words = {w.lower() for w in re.findall(r"\w+", prompt)}
        hits = [t for t, (keys, _) in TOPICS.items() if words & set(keys)]
        return hits or ["general"]

    def _distribution(
        self, context: list[str], prompt_words: set[str], topics: list[str], model: str
    ) -> list[tuple[str, float]]:
        """Return (token, logprob) pairs, sorted by probability, for the next position."""
        raw = _MODEL.candidates(context)
        tail = "".join(context[-3:])
        keys = [_key(t) for t in context]
        seen = set(zip(keys, keys[1:], keys[2:], strict=False))
        last2 = tuple(_key(t) for t in context[-2:])
        logits: dict[str, float] = {}
        for tok, evidence in raw.items():
            logit = 2.4 * math.log(evidence + 0.01)
            if any(tok in _MODEL.topic_vocab[t] for t in topics):
                logit += 2.2
            if _key(tok) in prompt_words:
                logit += 0.5
            if context and tok == context[-1]:
                logit -= 4.0  # discourage immediate repetition
            if len(last2) == 2 and (*last2, _key(tok)) in seen:
                logit -= 2.5  # discourage looping on an n-gram we already produced
            logit += 0.6 * _unit_hash(model, tail, tok)  # model-specific "personality"
            logits[tok] = logit
        m = max(logits.values())
        z = sum(math.exp(v - m) for v in logits.values())
        dist = [(tok, v - m - math.log(z)) for tok, v in logits.items()]
        dist.sort(key=lambda kv: kv[1], reverse=True)
        return dist

    async def complete(
        self, prompt: str, settings: GenerationSettings, prefix: str = ""
    ) -> ProviderResult:
        if self.latency:
            await asyncio.sleep(self.latency)
        prompt_words = {w.lower() for w in re.findall(r"\w+", prompt)}
        topics = self._topics_for(prompt)
        context = tokenize(prefix)
        out: list[TokenInfo] = []
        finish = "length"
        min_len = min(settings.max_tokens, 24)
        for step in range(settings.max_tokens):
            dist = self._distribution(context, prompt_words, topics, settings.model)
            rng = random.Random(
                hashlib.sha256(
                    f"{settings.model}|{settings.temperature}|{prompt}|{prefix}|{step}".encode()
                ).digest()
            )
            if settings.temperature <= 1e-6:
                choice_idx = 0
            else:
                weights = [math.exp(lp / settings.temperature) for _, lp in dist]
                choice_idx = rng.choices(range(len(dist)), weights=weights, k=1)[0]
            token, logprob = dist[choice_idx]
            if not context and not out:
                token = token.lstrip()  # first token of a reply has no leading space
            alts = build_alternatives(
                (t.lstrip() if not context and not out else t, lp)
                for t, lp in dist[: settings.top_logprobs]
            )
            out.append(annotate_token(TokenInfo(token=token, logprob=logprob, top=alts)))
            context.append(token)
            if token in _SENTENCE_END and len(out) >= min_len and rng.random() < 0.45:
                finish = "stop"
                break
        return ProviderResult(tokens=out, finish_reason=finish, model=settings.model, method="mock")
