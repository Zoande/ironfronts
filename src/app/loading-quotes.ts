export interface LoadingQuote {
  kind: 'Field Notes' | 'Command Brief';
  text: string;
  source: string;
}

/** Rotated on the loading screen while the world initializes. */
export const LOADING_QUOTES: LoadingQuote[] = [
  { kind: 'Field Notes', text: 'No battle plan survives contact with the enemy.', source: 'Helmuth von Moltke the Elder' },
  { kind: 'Field Notes', text: 'The line between disorder and order lies in logistics.', source: 'Sun Tzu' },
  { kind: 'Field Notes', text: 'Amateurs talk strategy. Professionals talk logistics.', source: 'Omar Bradley' },
  { kind: 'Field Notes', text: 'In war, the will is directed at an animate object that reacts.', source: 'Carl von Clausewitz' },
  { kind: 'Field Notes', text: 'A good plan violently executed now is better than a perfect plan next week.', source: 'George S. Patton' },
  { kind: 'Field Notes', text: 'Let our advance worry them, not theirs worry us.', source: 'Erwin Rommel' },
  { kind: 'Field Notes', text: 'Peace is achieved through the readiness to fight for it.', source: 'Dwight D. Eisenhower' },
  { kind: 'Field Notes', text: 'He who defends everything defends nothing.', source: 'Frederick the Great' },
  { kind: 'Command Brief', text: 'Rivers and canals are chokepoints — hold the crossings and you hold the front.', source: 'Cartographic Division' },
  { kind: 'Command Brief', text: 'The road network carries your supply lines. Cut theirs before you press the attack.', source: 'Cartographic Division' },
  { kind: 'Command Brief', text: 'High ground slows the advance but sharpens the view. Use it to see the offensive coming.', source: 'Cartographic Division' },
  { kind: 'Command Brief', text: 'Provinces near a border change hands fastest — reinforce them first.', source: 'Cartographic Division' },
];
