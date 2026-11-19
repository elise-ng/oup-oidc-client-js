export default function random() {
  const source = typeof crypto !== "undefined" ? crypto : window.msCrypto;
  const bytes = source.getRandomValues(new Uint8Array(16));
  return Array.prototype.map.call(bytes, b => ("0" + b.toString(16)).slice(-2)).join("");
}
