// Generated from backend/app/providers/mock_corpus.py (same text, same topics).
// Each topic: trigger keywords matched against the prompt, and a few paragraphs.
export const TOPICS: Record<string, [keywords: string[], text: string]> = {
  lighthouse: [
    ['lighthouse', 'keeper', 'sea', 'ocean', 'storm', 'story', 'ship', 'island', 'coast'],
    'The old lighthouse keeper climbed the spiral stairs every night to light the lamp. The storm was coming from the north, and the sea was dark and restless. She had kept the light burning for thirty years, and she had never once let it fail. That night a small ship appeared on the horizon, and the keeper knew that the light was the only thing between the sailors and the rocks. The wind howled against the glass, but the lamp kept turning, slow and steady. In the morning the storm was gone, and the ship was safe in the harbor.',
  ],
  space: [
    ['space', 'star', 'stars', 'planet', 'moon', 'universe', 'galaxy', 'astronaut', 'mars'],
    'The universe is vast, and most of it is dark and silent. A star is a giant ball of hot gas that burns for billions of years. When a star runs out of fuel, it can collapse into a black hole or explode as a supernova. The light from distant galaxies has traveled for millions of years to reach our eyes. The astronaut looked out of the window and saw the blue planet turning slowly below. Every night the stars remind us how small we are, and how much there is still to discover.',
  ],
  llm: [
    [
      'model',
      'language',
      'ai',
      'token',
      'tokens',
      'neural',
      'llm',
      'probability',
      'machine',
      'learning',
      'gpt',
      'intelligence',
    ],
    'A language model predicts the next token based on the tokens that came before it. At every step the model assigns a probability to each possible token, and then one token is sampled. When the model is confident, one token has most of the probability. When the model is uncertain, several tokens are almost equally likely, and a small change can send the text down a very different path. These moments of uncertainty are where hallucinations often begin. Temperature controls how much randomness is used when the next token is chosen.',
  ],
  cooking: [
    ['cook', 'cooking', 'recipe', 'bread', 'food', 'kitchen', 'pasta', 'soup', 'bake'],
    'The secret to good bread is patience. First, mix the flour, water, salt, and yeast until the dough comes together. Then let the dough rest for an hour, until it has doubled in size. The kitchen was warm, and the smell of fresh bread filled the house. A simple soup needs only a few good ingredients and a little time. Taste the food as you cook, and add salt slowly, because you can always add more but you can never take it away.',
  ],
  forest: [
    ['forest', 'tree', 'trees', 'nature', 'fox', 'wolf', 'woods', 'river', 'mountain'],
    'Deep in the forest, the trees were so tall that the light barely reached the ground. A small fox moved quietly between the roots, listening for the sound of the river. The mountain rose above the woods, and its peak was covered in snow. Every autumn the leaves turned gold and red, and the forest was quiet and calm. The river carried the cold water from the mountain down to the sea.',
  ],
  history: [
    [
      'history',
      'war',
      'empire',
      'ancient',
      'king',
      'rome',
      'science',
      'invention',
      'discovery',
      'century',
    ],
    'In the ancient world, the empire was built on roads, trade, and law. The king believed that knowledge was more powerful than gold. In the seventeenth century, a new way of thinking changed science forever: every idea had to be tested with careful experiments. The printing press was an invention that allowed ideas to spread faster than ever before, and the world was never the same again.',
  ],
  city: [
    ['city', 'night', 'street', 'robot', 'future', 'detective', 'rain', 'train', 'neon'],
    'The city never slept. The rain fell on the neon streets, and the last train rushed past the empty station. The detective walked slowly through the crowd, looking for a face she had seen only once. Somewhere a robot was sweeping the street, humming a song that nobody remembered. In the future, the city would be quiet and green, but tonight it was loud, bright, and alive.',
  ],
  general: [
    [],
    'Once upon a time, there was a small village at the edge of the world. The people there believed that every story had two endings, and that the choice between them was made in a single moment. It was a quiet morning, and the sun was rising over the hills. The answer is simple, but the reason is surprisingly deep. Here is a short explanation. There are three important ideas to understand, and the first one is the most important.',
  ],
}
