import { readZipEntry } from './zip';

/**
 * Tables from a .docx as text grids. Horizontal merges (w:gridSpan) repeat the cell across the
 * columns it spans; vertical merges (w:vMerge continuation) repeat the cell above. So every row of
 * a table has one entry per grid column and a column index means the same thing in every row.
 */
export async function docxTables(buf: ArrayBuffer | Uint8Array): Promise<string[][][]> {
  const xmlBytes = await readZipEntry(buf, 'word/document.xml');
  if (!xmlBytes) throw new Error('Not a Word document (word/document.xml missing)');
  return tablesFromDocumentXml(new TextDecoder().decode(xmlBytes));
}

const decodeEntities = (s: string) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'amp') return '&';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    return String.fromCodePoint(k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  });

export function tablesFromDocumentXml(xml: string): string[][][] {
  const tables: string[][][] = [];
  for (const tbl of xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? []) {
    const grid: string[][] = [];
    for (const tr of tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []) {
      const row: string[] = [];
      for (const tc of tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []) {
        const paras = (tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map((p) =>
          decodeEntities((p.match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')),
        );
        let text = paras.join('\n').trim();
        const span = Number(/<w:gridSpan w:val="(\d+)"\/>/.exec(tc)?.[1] ?? 1);
        const vMerge = /<w:vMerge(?: w:val="(\w+)")?\/>/.exec(tc);
        const col = row.length;
        if (vMerge && vMerge[1] !== 'restart') text = grid[grid.length - 1]?.[col] ?? '';
        for (let i = 0; i < span; i++) row.push(text);
      }
      grid.push(row);
    }
    tables.push(grid);
  }
  return tables;
}
