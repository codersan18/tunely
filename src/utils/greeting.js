// "Good morning, <name>" on Home. The name is the nickname set in Profile, else the first name.

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** The name to greet: the nickname, else the first word of the account name, else ''. */
export function greetingName(user) {
  const nick = (user?.nickname || '').trim();
  if (nick) return nick;
  return (user?.name || '').trim().split(/\s+/)[0] || '';
}
