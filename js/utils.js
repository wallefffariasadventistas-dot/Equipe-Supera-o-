// Funções utilitárias puras (sem dependência de Firestore, DOM ou estado global da aplicação)

export function moedaParaFloat(v) {
  // "1.234,56" → 1234.56  |  "1234" → 1234.00
  v = String(v).trim().replace(/\s/g,'');
  if (!v) return 0;
  // Already has comma: treat as pt-BR  e.g. "1.234,56" or "100,00"
  if (v.includes(',')) {
    v = v.replace(/\./g,'').replace(',','.');
  }
  return parseFloat(v) || 0;
}

export function floatParaMoeda(v) {
  v = parseFloat(v) || 0;
  return v.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
}

export const fmtMoeda = v => 'R$ ' + (parseFloat(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
export const fmtMini  = fmtMoeda;

// Escapa texto de entrada do usuário antes de inserir via innerHTML (evita XSS armazenado)
export function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// Escapa um campo para CSV (aspas/vírgulas/quebras de linha não desalinham as colunas no Excel)
export function csvField(v) {
  let s = String(v ?? '');
  // Neutraliza injeção de fórmula: um campo iniciando com =, +, -, @ ou tab pode ser interpretado
  // como fórmula ao abrir o CSV no Excel/Sheets. Prefixamos um apóstrofo para forçar texto puro.
  if (/^[=+\-@\t]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
}

// Formata horas evitando "estouro" de casas decimais por erro de ponto flutuante (ex: 2014.0999999999997)
// Converte para horas e minutos, ex: 2014h ou 2014h 30min
export const fmtHoras = v => {
  const totalMin = Math.round((parseFloat(v)||0) * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
};

// Conta apenas dias efetivamente trabalhados (exclui dias justificados, que não contam para a métrica)
export const contarDiasTrabalhados = regs => regs.filter(r => !r.justificado).length;

export const getHoje  = () => {
  const agora = new Date();
  const offsetBrasilia = -3 * 60; // minutos
  const localTime = new Date(agora.getTime() + (offsetBrasilia - (-agora.getTimezoneOffset())) * 60000);
  const y = localTime.getFullYear();
  const m = String(localTime.getMonth()+1).padStart(2,'0');
  const d = String(localTime.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
};
export const iniciais = n => (n||'').split(' ').filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();
export const getDiaSemana = d => ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][new Date(d+'T12:00:00').getDay()];
export const formatarData = d => { const [y,m,dd]=d.split('-'); return `${dd}/${m}/${y}`; };

export const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
