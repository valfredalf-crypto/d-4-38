// Validazione ISIN secondo ISO 6166 (cifra di controllo Luhn sulle cifre espanse).
export function isValidIsin(isin) {
  if (typeof isin !== 'string' || !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) return false;
  const digits = isin
    .slice(0, 11)
    .split('')
    .map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c))
    .join('');
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(isin[11]);
}
