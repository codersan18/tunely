// Profile pictures to pick from (like Netflix's, but VibeRoom's own): a character on a colourful
// tile. "google" is the account's Google photo, when it has one. Ids are stored by the backend.

export const AVATARS = [
  { id: 'headphones', emoji: '🎧', colors: ['#1ED760', '#0B6E4F'] },
  { id: 'guitar', emoji: '🎸', colors: ['#FF6B6B', '#C0392B'] },
  { id: 'piano', emoji: '🎹', colors: ['#A29BFE', '#5F27CD'] },
  { id: 'drum', emoji: '🥁', colors: ['#FDCB6E', '#E17055'] },
  { id: 'mic', emoji: '🎤', colors: ['#FD79A8', '#B83280'] },
  { id: 'sax', emoji: '🎷', colors: ['#55EFC4', '#00897B'] },
  { id: 'fox', emoji: '🦊', colors: ['#FFB26B', '#E8590C'] },
  { id: 'panda', emoji: '🐼', colors: ['#B2BEC3', '#4B5563'] },
  { id: 'tiger', emoji: '🐯', colors: ['#FFD166', '#F77F00'] },
  { id: 'lion', emoji: '🦁', colors: ['#F6D365', '#C9A227'] },
  { id: 'koala', emoji: '🐨', colors: ['#9AD0EC', '#3A7CA5'] },
  { id: 'frog', emoji: '🐸', colors: ['#B8E994', '#38A169'] },
  { id: 'octopus', emoji: '🐙', colors: ['#FF9FF3', '#C44569'] },
  { id: 'unicorn', emoji: '🦄', colors: ['#E0C3FC', '#8E7CC3'] },
  { id: 'penguin', emoji: '🐧', colors: ['#74B9FF', '#0652DD'] },
  { id: 'dog', emoji: '🐶', colors: ['#FAD390', '#B7791F'] },
  { id: 'cat', emoji: '🐱', colors: ['#FFEAA7', '#E1B12C'] },
  { id: 'monkey', emoji: '🐵', colors: ['#D4A373', '#7F5539'] },
  { id: 'owl', emoji: '🦉', colors: ['#C8A2C8', '#6D597A'] },
  { id: 'alien', emoji: '👽', colors: ['#81ECEC', '#00A8A8'] },
  { id: 'robot', emoji: '🤖', colors: ['#A0AEC0', '#2D3748'] },
  { id: 'rocket', emoji: '🚀', colors: ['#4834D4', '#130F40'] },
  { id: 'moon', emoji: '🌙', colors: ['#2C3E50', '#000814'] },
  { id: 'rainbow', emoji: '🌈', colors: ['#48DBFB', '#0ABDE3'] },
];

export const GOOGLE_AVATAR = 'google';
const byId = Object.fromEntries(AVATARS.map((a) => [a.id, a]));
export const avatarById = (id) => byId[id] || AVATARS[0];

/** A starting picture for a new profile: one the account's profiles aren't using yet. */
export function freeAvatar(profiles = []) {
  const used = new Set(profiles.map((p) => p.avatar));
  return (AVATARS.find((a) => !used.has(a.id)) || AVATARS[0]).id;
}
