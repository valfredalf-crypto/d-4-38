// Renderer Markdown minimale e senza dipendenze.
// Esegue sempre l'escape dell'HTML prima di applicare la formattazione.
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inline(text) {
  let s = escapeHtml(text);
  // codice inline
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // grassetto / corsivo
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\b_([^_\n]+)_\b/g, '<em>$1</em>');
  // link [testo](url) — solo http(s)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

export function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const flushList = (buf, ordered) => {
    if (!buf.length) return;
    const tag = ordered ? 'ol' : 'ul';
    out.push(`<${tag}>${buf.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
    buf.length = 0;
  };

  let listBuf = [];
  let listOrdered = false;

  while (i < lines.length) {
    const line = lines[i];

    // Blocco di codice
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      flushList(listBuf, listOrdered);
      const lang = fence[1] || '';
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
      i++; // salta la fence di chiusura
      const escaped = escapeHtml(code.join('\n'));
      out.push(`<div class="code-wrap"><div class="code-head"><span class="code-lang">${escapeHtml(lang || 'code')}</span><button class="code-copy" type="button">Copia</button></div><pre><code>${escaped}</code></pre></div>`);
      continue;
    }

    // Tabella (riga con | e riga separatore ---)
    if (line.includes('|') && /^\s*\|?.*\|.*$/.test(line) && lines[i + 1] && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      flushList(listBuf, listOrdered);
      const parse = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const header = parse(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|')) { rows.push(parse(lines[i])); i++; }
      const thead = `<thead><tr>${header.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
      out.push(`<div class="table-wrap"><table>${thead}${tbody}</table></div>`);
      continue;
    }

    // Titoli
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushList(listBuf, listOrdered); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }

    // Citazione
    if (/^>\s?/.test(line)) { flushList(listBuf, listOrdered); out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); i++; continue; }

    // Linea orizzontale
    if (/^(\*\*\*|---|___)\s*$/.test(line)) { flushList(listBuf, listOrdered); out.push('<hr>'); i++; continue; }

    // Elenchi
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ol || ul) {
      const ordered = Boolean(ol);
      if (listBuf.length && ordered !== listOrdered) flushList(listBuf, listOrdered);
      listOrdered = ordered;
      listBuf.push((ol || ul)[1]);
      i++;
      continue;
    }

    // Riga vuota → chiude eventuale elenco
    if (/^\s*$/.test(line)) { flushList(listBuf, listOrdered); i++; continue; }

    // Paragrafo
    flushList(listBuf, listOrdered);
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }
  flushList(listBuf, listOrdered);
  return out.join('\n');
}
