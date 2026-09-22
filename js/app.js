
import {
  db, collection, doc, addDoc,
  setDoc, getDoc, getDocs, deleteDoc, updateDoc,
  onSnapshot, query, orderBy, where, writeBatch
} from "./firebase-config.js";
import {
  moedaParaFloat, floatParaMoeda, fmtMoeda, fmtMini, escapeHtml, csvField,
  fmtHoras, contarDiasTrabalhados, getHoje, iniciais, getDiaSemana, formatarData, MESES_PT
} from "./utils.js";

// ── SENHA DO ADMIN (persistida no Firestore) ──
async function carregarSenhaAdmin() {
  try {
    const ref  = doc(db,'config','admin');
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data().senha) {
      ADMIN_SENHA = snap.data().senha;
    } else {
      await setDoc(ref, { senha: ADMIN_SENHA });
    }
  } catch (e) {
    // Se falhar (offline, etc.), mantém a senha padrão em memória
    console.warn('Não foi possível carregar a senha do admin, usando padrão.', e);
  }
}
carregarSenhaAdmin();

// ── SENHA DO ADMIN DE RELATÓRIOS (persistida no Firestore, mesmo padrão da senha do admin) ──
async function carregarSenhaRelLider() {
  try {
    const ref  = doc(db,'config','rel_lider');
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data().senha) {
      LIDER_REL_SENHA = snap.data().senha;
    } else {
      await setDoc(ref, { senha: LIDER_REL_SENHA });
    }
  } catch (e) {
    console.warn('Não foi possível carregar a senha do admin de relatórios, usando padrão.', e);
  }
}
carregarSenhaRelLider();

// ── CAMPANHAS ──
// Cada "campanha" é uma temporada da equipe (ex: "Sonhando Alto 2026.2"), com seu próprio
// período e meta. Ao criar uma nova campanha, a anterior fica "finalizada" (só consulta) e
// todo cadastro/registro novo passa a ser gravado com o campanhaId da campanha ativa.
let CAMPANHA_ATIVA      = null;  // { id, titulo, dataInicio, dataFim, metaEquipe, ativa, criadoEm }
let campanhaVisualizada = null;  // id da campanha selecionada no dashboard do admin (default = ativa)
let todasCampanhas      = [];    // cache de todas as campanhas, mais recente primeiro

async function carregarCampanhas() {
  try {
    const snap = await getDocs(collection(db,'campanhas'));
    todasCampanhas = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (b.criadoEm||'').localeCompare(a.criadoEm||''));
    CAMPANHA_ATIVA = todasCampanhas.find(c => c.ativa) || todasCampanhas[0] || null;
    if (!campanhaVisualizada && CAMPANHA_ATIVA) campanhaVisualizada = CAMPANHA_ATIVA.id;
    if (CAMPANHA_ATIVA) {
      DATA_ENCERRAMENTO = CAMPANHA_ATIVA.dataFim;
      AGENDA_INICIO = CAMPANHA_ATIVA.dataInicio;
      AGENDA_FIM = CAMPANHA_ATIVA.dataFim;
      ['reg-data-escolhida','just-data'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.min = AGENDA_INICIO; el.max = DATA_ENCERRAMENTO; }
      });
    }
    renderSeletorCampanha();
  } catch (e) {
    console.warn('Não foi possível carregar as campanhas.', e);
  }
}
carregarCampanhas();

function getCampanhaPorId(id) {
  return todasCampanhas.find(c => c.id === id) || null;
}

function recomputeLiveArrays() {
  const cid = campanhaVisualizada;
  liveUsuarios   = cid ? allUsuarios.filter(u => u.campanhaId === cid)   : allUsuarios;
  liveRegistros  = cid ? allRegistros.filter(r => r.campanhaId === cid) : allRegistros;
  liveDevolucoes = cid ? allDevolucoes.filter(d => d.campanhaId === cid) : allDevolucoes;
  liveEstudos    = cid ? allEstudos.filter(e => e.campanhaId === cid)   : allEstudos;
}

function renderSeletorCampanha() {
  const sel = document.getElementById('campanha-selector');
  if (!sel) return;
  sel.innerHTML = todasCampanhas.map(c =>
    `<option value="${c.id}">${c.ativa ? '🟢' : '⚪'} ${escapeHtml(c.titulo)}${c.ativa ? ' (ativa)' : ' (finalizada)'}</option>`
  ).join('');
  if (campanhaVisualizada) sel.value = campanhaVisualizada;
}

document.getElementById('campanha-selector').addEventListener('change', function() {
  campanhaVisualizada = this.value;
  recomputeLiveArrays();
  const activeBtn = document.querySelector('#screen-admin .tab-btn.active');
  const activeTab = document.querySelector('#screen-admin .tab-panel.active');
  if (activeBtn && activeTab) abrirTabAdmin(activeTab.id, activeBtn);
});

document.getElementById('btn-nova-campanha').addEventListener('click', function() {
  document.getElementById('nc-titulo').value = '';
  document.getElementById('nc-data-inicio').value = '';
  document.getElementById('nc-data-fim').value = '';
  document.getElementById('nc-meta').value = '';
  document.getElementById('nc-msg').style.display = 'none';
  document.getElementById('modal-nova-campanha').style.display = 'flex';
});
document.getElementById('nc-btn-fechar').addEventListener('click', function() {
  document.getElementById('modal-nova-campanha').style.display = 'none';
});
document.getElementById('modal-nova-campanha').addEventListener('click', function(e) {
  if (e.target === this) this.style.display = 'none';
});
document.getElementById('btn-nc-confirmar').addEventListener('click', async function() {
  const titulo = document.getElementById('nc-titulo').value.trim();
  const dataInicio = document.getElementById('nc-data-inicio').value;
  const dataFim = document.getElementById('nc-data-fim').value;
  const metaEquipe = moedaParaFloat(document.getElementById('nc-meta').value);
  const msgEl = document.getElementById('nc-msg');
  msgEl.style.display = 'none';
  if (!titulo) { msgEl.textContent = '⚠️ Informe o título da campanha.'; msgEl.style.color = 'var(--danger)'; msgEl.style.display = 'block'; return; }
  if (!dataInicio || !dataFim) { msgEl.textContent = '⚠️ Informe as datas de início e término.'; msgEl.style.color = 'var(--danger)'; msgEl.style.display = 'block'; return; }
  if (dataFim <= dataInicio) { msgEl.textContent = '⚠️ A data de término deve ser depois da data de início.'; msgEl.style.color = 'var(--danger)'; msgEl.style.display = 'block'; return; }
  if (!metaEquipe || metaEquipe <= 0) { msgEl.textContent = '⚠️ Informe uma meta geral válida.'; msgEl.style.color = 'var(--danger)'; msgEl.style.display = 'block'; return; }
  try {
    showSyncStatus('💾 Criando campanha...', 'saving');
    const batch = writeBatch(db);
    todasCampanhas.filter(c => c.ativa).forEach(c => batch.update(doc(db,'campanhas',c.id), { ativa: false }));
    const novoId = Date.now().toString();
    batch.set(doc(db,'campanhas',novoId), { titulo, dataInicio, dataFim, metaEquipe, ativa: true, criadoEm: getHoje() });
    await batch.commit();
    showSyncStatus('✅ Campanha criada!', 'saved');
    await carregarCampanhas();
    campanhaVisualizada = novoId;
    recomputeLiveArrays();
    renderSeletorCampanha();
    document.getElementById('modal-nova-campanha').style.display = 'none';
    mostrarToast('🚀 Campanha "'+titulo+'" criada e ativada!');
    const activeBtn = document.querySelector('#screen-admin .tab-btn.active');
    const activeTab = document.querySelector('#screen-admin .tab-panel.active');
    if (activeBtn && activeTab) abrirTabAdmin(activeTab.id, activeBtn);
  } catch(e) {
    msgEl.textContent = '❌ Erro: ' + e.message; msgEl.style.color = 'var(--danger)'; msgEl.style.display = 'block';
    showSyncStatus('❌ Erro', 'error');
  }
});

// ── TEMA DO SISTEMA (persistido no Firestore, aplicado para todos) ──
let TEMA_ATUAL = 'escuro';
function aplicarTema(nome) {
  TEMA_ATUAL = nome || 'escuro';
  document.documentElement.setAttribute('data-theme', TEMA_ATUAL);
}
function iniciarSincroniaTema() {
  try {
    onSnapshot(doc(db,'config','tema'), (snap) => {
      if (snap.exists() && snap.data().nome) {
        aplicarTema(snap.data().nome);
        if (typeof renderConfigAdmin === 'function') {
          const painel = document.getElementById('admin-config');
          if (painel && painel.classList.contains('active')) renderConfigAdmin();
        }
      }
    });
  } catch (e) {
    console.warn('Não foi possível sincronizar o tema em tempo real.', e);
  }
}
iniciarSincroniaTema();


// ── MÁSCARA DE MOEDA ──
function aplicarMascara(el) {
  let raw = el.value.replace(/\D/g,'');   // apenas dígitos
  if (!raw) { el.value = ''; return; }
  let num = parseInt(raw, 10) / 100;       // divide por 100: centavos → reais
  el.value = num.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
}

function bindMoeda(id) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (!el) return;
  // Convert existing numeric value on bind
  if (el.value && !isNaN(parseFloat(el.value))) {
    el.value = floatParaMoeda(parseFloat(el.value));
  }
  el.addEventListener('input', function() { aplicarMascara(this); });
  el.addEventListener('blur',  function() {
    if (!this.value.trim()) return;
    aplicarMascara(this); // re-format on blur
  });
}

function bindTodasMascaras() {
  ['reg-vista','reg-prazo','l-reg-vista','l-reg-prazo',
   'cad-meta-custom','adm-novo-lider-alvo','nc-meta'].forEach(bindMoeda);
}

function bindMascarasInline(container) {
  container.querySelectorAll('[data-money]').forEach(el => {
    // Set formatted initial value
    const raw = parseFloat(el.getAttribute('data-raw') || el.value) || 0;
    el.value = floatParaMoeda(raw);
    el.addEventListener('input', function() { aplicarMascara(this); });
  });
}

// ── CONSTANTS ──
let ADMIN_SENHA       = '0000';
let DATA_ENCERRAMENTO = '2026-08-25'; // atualizado dinamicamente com a dataFim da campanha ativa
let chartInstances      = {};
let currentUser         = null;
let modalColportorId    = null;
let regDataSelecionada  = null;
let rankOrdem           = 'vendas';

// Live data cache (updated by Firestore listeners)
let liveUsuarios   = [];
let liveRegistros  = [];
let liveDevolucoes = [];
let liveEstudos    = [];
// Cópias não-filtradas (todas as campanhas); live* acima é sempre filtrado pela campanha visualizada
let allUsuarios    = [];
let allRegistros   = [];
let allDevolucoes  = [];
let allEstudos     = [];
let unsubUsuarios   = null;
let unsubRegistros  = null;
let unsubDevolucoes = null;
let unsubEstudos    = null;

// ── TABELA DE PREÇOS — DEVOLUÇÃO DE MATERIAL (valor c/ dízimo, SELS Unificado 2026/2027) ──
const TABELA_DEVOLUCAO = [
  { categoria:'Bem Estar', itens:[
    {nome:'21 Dias para Mudar', preco:116.95},
    {nome:'Revolucione o Seu Futuro', preco:103.39},
    {nome:'Mente Positiva - Enc.', preco:148.40},
    {nome:'O Amanhã Começa Hoje - Magabook', preco:107.48},
    {nome:'Sucesso em Dose Dupla - Enc.', preco:131.24},
  ]},
  { categoria:'Bíblias', itens:[
    {nome:'Bíblia CPB RA06 - Mistério da Profecia', preco:27.06},
    {nome:'Coleção Bíblia Ilustrada Família - 6 Volumes - 4.0', preco:704.63},
    {nome:'O Mundo Colorido da Bíblia - 4.0', preco:105.64},
  ]},
  { categoria:'Denominacionais', itens:[
    {nome:'A Última Chamada', preco:116.52},
    {nome:'Desejado de Todas as Nações, O', preco:48.51},
    {nome:'Grande Conflito, O', preco:41.71},
    {nome:'Mistério da Profecia, O', preco:88.90},
    {nome:'Vida de Jesus Luxo - Magabook', preco:145.60},
    {nome:'Vida de Jesus - Missão Resgate', preco:62.67},
    {nome:'Vida de Jesus - Especial de Natal', preco:68.90},
  ]},
  { categoria:'Família', itens:[
    {nome:'Coleção Projeto Vencedores N.A - 28 vol.', preco:337.42},
    {nome:'Felizes no Amor - Enc.', preco:85.73},
    {nome:'Felizes no Amor Enc. - Edição Atualizada Cp Nova', preco:113.75},
    {nome:'Filhos Vencedores - Enc.', preco:111.51},
    {nome:'Filhos Vencedores - Enc. - Edição Atualizada Cp Nova', preco:138.86},
  ]},
  { categoria:'Saúde', itens:[
    {nome:'101 Segredos Para Viver Melhor', preco:144.90},
    {nome:'Corpo Saudável', preco:197.47},
    {nome:'Maravilhoso Poder das Plantas - Capa Nova - Colportagem', preco:116.52},
    {nome:'Poder Medicinal dos Alimentos, O - Enc.', preco:164.90},
    {nome:'Poder Medicinal dos Sucos e Shakes, O', preco:197.47},
    {nome:'Sabor da Saúde, O - Enc.', preco:140.38},
    {nome:'Saúde com Sabor - Enc.', preco:132.76},
    {nome:'Saúde com Sabor - Missão Resgate / D.S.A.', preco:62.67},
    {nome:'Segredo da Saúde, O - Missão Resgate', preco:98.57},
  ]},
  { categoria:'Revistas', itens:[
    {nome:'Revista Nosso Amiguinho Junior - Atrasado', preco:11.23},
    {nome:'Revista Nosso Amiguinho - Nº Atrasado', preco:14.81},
    {nome:'Revista Vida e Saúde - Promocional/Nº Atrasado', preco:15.92},
  ]},
  { categoria:'Assinaturas - Revistas', itens:[
    {nome:'Assinatura Nosso Amiguinho Junior', preco:134.72},
    {nome:'Assinatura Nosso Amiguinho - 01 Ano (Exemplar Assinante)', preco:177.72},
    {nome:'Assinatura Vida e Saúde - 01 Ano (Exemplar Assinante)', preco:191.03},
  ]},
  { categoria:'Brindes', itens:[
    {nome:'Livro Ilustrado N.A - Com Figurinhas', preco:32.10},
    {nome:'Miniaturas N.A.', preco:36.00},
  ]},
];

// Devolução do colportor (registro único, sempre sobrescrito na última atualização)
function getDevolucaoUser(uid) {
  return liveDevolucoes.find(d => d.id === uid) || null;
}
function getDevolucaoTotal(uid) {
  const d = getDevolucaoUser(uid);
  return d && d.total ? d.total : 0;
}
// Logos em base64 definidas uma única vez e reaplicadas via classe (evita duplicar o mesmo arquivo várias vezes no HTML)
const LOGO_LOGIN_B64  = "data:image/png;base64,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";
const LOGO_NAVBAR_B64 = "data:image/png;base64,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";
document.querySelectorAll('.logo-login-img').forEach(img => img.src = LOGO_LOGIN_B64);
document.querySelectorAll('.logo-navbar-img').forEach(img => img.src = LOGO_NAVBAR_B64);

// Calcula médias diárias de um colportor com base APENAS nos dias em que ele registrou algo (exclui dias justificados)
const calcMediasDiarias = regs => {
  const dias = contarDiasTrabalhados(regs);
  if (dias === 0) return { dias:0, mediaVendas:0, mediaOfertas:0, mediaHoras:0 };
  const vendas  = regs.reduce((s,r)=>s+(r.vista||0),0);
  const ofertas = regs.reduce((s,r)=>s+(r.ofertas||0),0);
  const horas   = regs.reduce((s,r)=>s+(r.horas||0),0);
  return { dias, mediaVendas: vendas/dias, mediaOfertas: ofertas/dias, mediaHoras: horas/dias };
};
// getHoje: retorna a data de HOJE no fuso de Brasília (UTC-3), não em UTC.
// Isso garante que um registro feito até 23:59 do horário local conte para o dia correto,
// já que usar toISOString() (UTC) faria a data virar antes da hora real em fusos negativos.
const getRegsUser  = uid => liveRegistros.filter(r=>r.userId===uid).sort((a,b)=>a.data.localeCompare(b.data));
const getVistaUser = uid => getRegsUser(uid).reduce((s,r)=>s+(r.vista||0),0);

function showSyncStatus(msg, type='saving') {
  const el = document.getElementById('sync-status');
  el.textContent = msg; el.className = type; el.style.display='block';
  if (type==='saved') setTimeout(()=>el.style.display='none', 2000);
}
function mostrarToast(msg, isError=false) {
  let t = document.getElementById('toast-global');
  if (!t) { t=document.createElement('div'); t.id='toast-global'; t.style.cssText='position:fixed;bottom:70px;left:50%;transform:translateX(-50%);padding:12px 24px;border-radius:12px;font-size:14px;font-weight:600;font-family:Inter,sans-serif;z-index:9999;transition:opacity 0.3s;box-shadow:0 8px 32px rgba(0,0,0,0.4);'; document.body.appendChild(t); }
  t.textContent=msg; t.style.background=isError?'#EF5350':'#FFB100'; t.style.color=isError?'#fff':'#000'; t.style.opacity='1';
  clearTimeout(t._t); t._t=setTimeout(()=>t.style.opacity='0', 2800);
}
function mostrarConfirm(titulo, sub, cb) {
  const m=document.getElementById('confirm-modal-global');
  document.getElementById('conf-titulo').textContent=titulo;
  document.getElementById('conf-sub').textContent=sub;
  m.style.display='flex';
  document.getElementById('conf-ok').onclick=()=>{ m.style.display='none'; cb(); };
  document.getElementById('conf-cancel').onclick=()=>m.style.display='none';
  m.onclick=e=>{ if(e.target===m) m.style.display='none'; };
}
function mostrarInputModal(titulo, sub, ph, cb) {
  const m=document.getElementById('input-modal-global');
  document.getElementById('imod-titulo').textContent=titulo;
  document.getElementById('imod-sub').textContent=sub;
  const inp=document.getElementById('imod-input'); inp.placeholder=ph; inp.value='';
  m.style.display='flex'; setTimeout(()=>inp.focus(),50);
  document.getElementById('imod-ok').onclick=()=>{ m.style.display='none'; cb(inp.value.trim()); };
  document.getElementById('imod-cancel').onclick=()=>m.style.display='none';
  inp.onkeydown=e=>{ if(e.key==='Enter'){ m.style.display='none'; cb(inp.value.trim()); } };
  m.onclick=e=>{ if(e.target===m) m.style.display='none'; };
}

// ── SCREEN NAV ──
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── FIREBASE LISTENERS ──
// Vários onSnapshot podem disparar quase juntos (ex.: ao carregar a página, os 4 chegam em sequência).
// scheduleDataUpdate() agrupa essas atualizações num único re-render por burst, em vez de um por listener.
let dataUpdateScheduled = false;
function scheduleDataUpdate() {
  if (dataUpdateScheduled) return;
  dataUpdateScheduled = true;
  Promise.resolve().then(() => { dataUpdateScheduled = false; onDataUpdate(); });
}
function startListeners() {
  // Usuarios listener
  if (unsubUsuarios) unsubUsuarios();
  unsubUsuarios = onSnapshot(collection(db,'usuarios'), snap => {
    allUsuarios = snap.docs.map(d=>({id:d.id,...d.data()}));
    recomputeLiveArrays();
    scheduleDataUpdate();
  }, err => console.warn('usuarios listener:', err));

  // Registros listener
  if (unsubRegistros) unsubRegistros();
  unsubRegistros = onSnapshot(collection(db,'registros'), snap => {
    allRegistros = snap.docs.map(d=>({id:d.id,...d.data()}));
    recomputeLiveArrays();
    scheduleDataUpdate();
  }, err => console.warn('registros listener:', err));

  // Devoluções listener
  if (unsubDevolucoes) unsubDevolucoes();
  unsubDevolucoes = onSnapshot(collection(db,'devolucoes'), snap => {
    allDevolucoes = snap.docs.map(d=>({id:d.id,...d.data()}));
    recomputeLiveArrays();
    scheduleDataUpdate();
  }, err => console.warn('devolucoes listener:', err));

  // Estudos Bíblicos listener
  if (unsubEstudos) unsubEstudos();
  unsubEstudos = onSnapshot(collection(db,'estudosBiblicos'), snap => {
    allEstudos = snap.docs.map(d=>({id:d.id,...d.data()}));
    recomputeLiveArrays();
    scheduleDataUpdate();
  }, err => console.warn('estudosBiblicos listener:', err));
}

function stopListeners() {
  if (unsubUsuarios)   { unsubUsuarios();   unsubUsuarios=null; }
  if (unsubRegistros)  { unsubRegistros();  unsubRegistros=null; }
  if (unsubDevolucoes) { unsubDevolucoes(); unsubDevolucoes=null; }
  if (unsubEstudos)    { unsubEstudos();    unsubEstudos=null; }
}

function onDataUpdate() {
  // Re-render active screen
  const adminActive = document.getElementById('screen-admin').classList.contains('active');
  const colActive   = document.getElementById('screen-colportor').classList.contains('active');
  if (adminActive) {
    const activeTab = document.querySelector('#screen-admin .tab-panel.active');
    if (activeTab) {
      const id = activeTab.id;
      if (id==='admin-dashboard') { renderAdminDashboard(); bindDashDatePicker(); }
      if (id==='admin-ranking')   { renderRanking(); renderRankingBolsa(); }
      if (id==='admin-equipe')    renderTabelaEquipe();
      if (id==='admin-diario')    renderPreenchimentoDiario();
      if (id==='admin-graficos')  renderGraficosAdmin();
      if (id==='admin-relatorio') renderRelatorioGeral();
      if (id==='admin-estudos')   renderTabelaEstudosAdmin();
    }
  }
  if (colActive && currentUser) {
    const activeTab = document.querySelector('#screen-colportor .tab-panel.active');
    if (activeTab) {
      const id = activeTab.id;
      if (id==='tab-painel')    renderPainel();
      if (id==='tab-historico') { renderResumoHistorico(); renderHistorico(); }
    }
  }
}

// ── LOGIN ──
// Attach admin buttons via direct onclick for reliability in iframe
document.getElementById('btn-abrir-admin').onclick = function() {
  document.getElementById('admin-area').style.display='block';
  document.getElementById('btn-abrir-admin').style.display='none';
  document.getElementById('admin-error').style.display='none';
  document.getElementById('admin-senha-input').value='';
  setTimeout(()=>document.getElementById('admin-senha-input').focus(),80);
};
document.getElementById('btn-fechar-admin').onclick = function() {
  document.getElementById('admin-area').style.display='none';
  document.getElementById('btn-abrir-admin').style.display='block';
};
document.getElementById('btn-confirmar-admin').onclick = function() {
  const s = document.getElementById('admin-senha-input').value.trim();
  if (s===ADMIN_SENHA) {
    showScreen('screen-admin');
    startListeners();
    renderAdminDashboard();
    abrirTabAdmin('admin-dashboard', document.getElementById('atbtn-dashboard'));
      } else {
    document.getElementById('admin-error').style.display='block';
    document.getElementById('admin-senha-input').value='';
    document.getElementById('admin-senha-input').focus();
  }
};
document.getElementById('admin-senha-input').onkeydown = function(e) {
  if(e.key==='Enter') document.getElementById('btn-confirmar-admin').onclick();
};
document.getElementById('btn-ir-cadastro').onclick = ()=>showScreen('screen-cadastro');
document.getElementById('btn-voltar-login').onclick = ()=>showScreen('screen-login');
document.getElementById('btn-logout-col').onclick = ()=>{ currentUser=null; stopListeners(); showScreen('screen-login'); };
document.getElementById('btn-logout-adm').onclick = ()=>{ stopListeners(); showScreen('screen-login'); };

document.getElementById('btn-entrar').addEventListener('click', async () => {
  const nome  = document.getElementById('login-nome').value.trim();
  const senha = document.getElementById('login-senha').value.trim();
  const err   = document.getElementById('login-error');
  err.style.display='none';
  if (!nome||!senha) { err.style.display='block'; err.textContent='Preencha nome e senha.'; return; }
  if (!CAMPANHA_ATIVA) { err.style.display='block'; err.textContent='Carregando dados da campanha, aguarde um instante e tente novamente.'; return; }

  const snap = await getDocs(query(collection(db,'usuarios'), where('nomeLC','==',nome.toLowerCase()), where('campanhaId','==',CAMPANHA_ATIVA.id)));
  if (snap.empty) { err.style.display='block'; err.textContent='Nome ou senha inválidos.'; return; }
  const user = snap.docs.find(d=>d.data().senha===senha);
  if (!user)  { err.style.display='block'; err.textContent='Nome ou senha inválidos.'; return; }

  currentUser = { id: user.id, ...user.data() };
  entrarComoColportor();
});

document.getElementById('btn-logout-adm').addEventListener('click', ()=>{ stopListeners(); showScreen('screen-login'); });

// ── CADASTRO ──
function toggleMetaCustom() {
  document.getElementById('meta-custom-wrap').style.display = document.getElementById('cad-meta').value==='custom'?'block':'none';
}
window.toggleMetaCustom = toggleMetaCustom;

document.getElementById('btn-criar-conta').addEventListener('click', async ()=>{
  const nome   = document.getElementById('cad-nome').value.trim();
  const tel    = document.getElementById('cad-tel').value.trim();
  const metaS  = document.getElementById('cad-meta').value;
  const metaC  = document.getElementById('cad-meta-custom').value;
  const senha  = document.getElementById('cad-senha').value.trim();
  const senha2 = document.getElementById('cad-senha2').value.trim();
  const err    = document.getElementById('cad-error');
  const suc    = document.getElementById('cad-success');
  err.style.display='none'; suc.style.display='none';

  if (!nome||!tel||!metaS||!senha) { err.style.display='block'; err.textContent='Preencha todos os campos.'; return; }
  if (!/^\d{4}$/.test(senha)) { err.style.display='block'; err.textContent='Senha deve ter 4 dígitos numéricos.'; return; }
  if (senha!==senha2) { err.style.display='block'; err.textContent='Senhas não coincidem.'; return; }
  const meta = metaS==='custom' ? moedaParaFloat(metaC) : parseFloat(metaS);
  if (!meta||meta<=0) { err.style.display='block'; err.textContent='Informe um valor de meta válido.'; return; }
  if (!CAMPANHA_ATIVA) { err.style.display='block'; err.textContent='Carregando dados da campanha, aguarde um instante e tente novamente.'; return; }

  // Check duplicate name (apenas dentro da campanha ativa)
  const dup = await getDocs(query(collection(db,'usuarios'), where('nomeLC','==',nome.toLowerCase()), where('campanhaId','==',CAMPANHA_ATIVA.id)));
  if (!dup.empty) { err.style.display='block'; err.textContent='Já existe uma conta com este nome nesta campanha.'; return; }

  showSyncStatus('💾 Criando conta...','saving');
  try {
    const id = Date.now().toString();
    const campanhaId = CAMPANHA_ATIVA.id;
    await setDoc(doc(db,'usuarios',id), { nome, nomeLC:nome.toLowerCase(), tel, meta, senha, campanhaId, criadoEm:getHoje() });
    currentUser = { id, nome, tel, meta, senha, campanhaId, criadoEm:getHoje() };
    showSyncStatus('✅ Conta criada!','saved');
    suc.style.display='block';
    setTimeout(()=>entrarComoColportor(), 1200);
  } catch(e) { err.style.display='block'; err.textContent='Erro ao criar conta: '+e.message; showSyncStatus('❌ Erro','error'); }
});

// ── ENTRAR COMO COLPORTOR ──
function entrarComoColportor() {
  showScreen('screen-colportor');
  startListeners();
  bindTodasMascaras();
  abrirTabCol('tab-painel', document.getElementById('tbtn-painel'));
  atualizarDataRegistro();
}

// ── TABS COLPORTOR ──
function abrirTabCol(id, btn) {
  document.querySelectorAll('#screen-colportor .tab-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('#screen-colportor .tab-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
  if (id==='tab-painel')    renderPainel();
  if (id==='tab-registro')  atualizarDataRegistro();
  if (id==='tab-historico') { renderResumoHistorico(); renderHistorico(); }
  if (id==='tab-graficos')  renderGraficosColportor();
  if (id==='tab-relatorio') renderRelatorioIndividual();
  if (id==='tab-semana-maxima') renderSmaxColportor();
  if (id==='tab-premiacoes') renderPremicoesGallery('prem-gallery-col');
}
['painel','registro','historico','graficos','relatorio','semana-maxima','premiacoes'].forEach(id=>{
  document.getElementById('tbtn-'+id).addEventListener('click', function(){ abrirTabCol('tab-'+id,this); });
});
document.getElementById('tbtn-config').addEventListener('click', function(){
  abrirPerfilColportor();
});

// ── TABS ADMIN ──
function abrirTabAdmin(id, btn) {
  document.querySelectorAll('#screen-admin .tab-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('#screen-admin .tab-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
  if (id==='admin-dashboard') renderAdminDashboard();
  if (id==='admin-ranking')   { renderRanking(); renderRankingBolsa(); }
  if (id==='admin-equipe')    renderTabelaEquipe();
  if (id==='admin-diario')    renderPreenchimentoDiario();
  if (id==='admin-graficos')  renderGraficosAdmin();
  if (id==='admin-relatorio') renderRelatorioGeral();
  if (id==='admin-lider')    renderAreaLider();
  if (id==='admin-semana-maxima') renderSmaxAdmin();
  if (id==='admin-premiacoes') renderPremicoesGallery('prem-gallery-adm');
  if (id==='admin-estudos')    renderTabelaEstudosAdmin();
  if (id==='admin-config')    renderConfigAdmin();
}
['dashboard','ranking','equipe','diario','graficos','relatorio','lider','semana-maxima','premiacoes','estudos','config'].forEach(id=>{
  document.getElementById('atbtn-'+id).addEventListener('click', function(){ abrirTabAdmin('admin-'+id,this); });
});

// ── CONFIGURAÇÕES (ADMIN) ──
let temaSelecionadoAdm = null;

function renderConfigAdmin() {
  ['cfg-senha-atual','cfg-senha-nova','cfg-senha-confirma'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const msg = document.getElementById('cfg-senha-msg');
  if (msg) msg.style.display = 'none';

  temaSelecionadoAdm = TEMA_ATUAL;
  document.querySelectorAll('.tema-opcao').forEach(btn=>{
    btn.classList.toggle('selecionada', btn.getAttribute('data-tema') === TEMA_ATUAL);
  });
  const temaMsg = document.getElementById('tema-msg');
  if (temaMsg) temaMsg.style.display = 'none';
}

document.querySelectorAll('.tema-opcao').forEach(btn=>{
  btn.addEventListener('click', () => {
    temaSelecionadoAdm = btn.getAttribute('data-tema');
    document.querySelectorAll('.tema-opcao').forEach(b=>b.classList.remove('selecionada'));
    btn.classList.add('selecionada');
    aplicarTema(temaSelecionadoAdm); // pré-visualização imediata para o admin
  });
});

document.getElementById('btn-salvar-tema').addEventListener('click', async () => {
  const temaMsg = document.getElementById('tema-msg');
  const nome = temaSelecionadoAdm || TEMA_ATUAL;
  try {
    await setDoc(doc(db,'config','tema'), { nome });
    aplicarTema(nome);
    if (temaMsg) {
      temaMsg.textContent = 'Tema aplicado para todos os usuários!';
      temaMsg.style.color = 'var(--ouro-claro)';
      temaMsg.style.display = 'block';
    }
  } catch (e) {
    if (temaMsg) {
      temaMsg.textContent = 'Erro ao salvar o tema. Tente novamente.';
      temaMsg.style.color = 'var(--danger)';
      temaMsg.style.display = 'block';
    }
  }
});

function mostrarMsgSenhaAdmin(texto, sucesso) {
  const msg = document.getElementById('cfg-senha-msg');
  if (!msg) return;
  msg.textContent = texto;
  msg.style.color = sucesso ? 'var(--ouro-claro)' : 'var(--danger)';
  msg.style.display = 'block';
}

document.getElementById('btn-salvar-senha-adm').addEventListener('click', async () => {
  const atual    = document.getElementById('cfg-senha-atual').value.trim();
  const nova     = document.getElementById('cfg-senha-nova').value.trim();
  const confirma = document.getElementById('cfg-senha-confirma').value.trim();

  if (atual !== ADMIN_SENHA) { mostrarMsgSenhaAdmin('Senha atual incorreta.', false); return; }
  if (nova.length < 4) { mostrarMsgSenhaAdmin('A nova senha deve ter pelo menos 4 dígitos.', false); return; }
  if (nova !== confirma) { mostrarMsgSenhaAdmin('As senhas não coincidem.', false); return; }
  if (nova === atual) { mostrarMsgSenhaAdmin('A nova senha deve ser diferente da atual.', false); return; }

  try {
    await setDoc(doc(db,'config','admin'), { senha: nova });
    ADMIN_SENHA = nova;
    mostrarMsgSenhaAdmin('Senha alterada com sucesso!', true);
    ['cfg-senha-atual','cfg-senha-nova','cfg-senha-confirma'].forEach(id=>{ document.getElementById(id).value=''; });
  } catch (e) {
    mostrarMsgSenhaAdmin('Erro ao salvar a nova senha. Tente novamente.', false);
  }
});

// ── DOCK MAGNIFY (efeito estilo dock do macOS nas abas) ──
function initDockMagnify() {
  const MAX_SCALE  = 1.55;
  const INFLUENCE  = 90; // raio de influência em px
  document.querySelectorAll('.tab-nav').forEach(nav => {
    const getBtns = () => Array.from(nav.querySelectorAll('.tab-btn'));
    nav.addEventListener('mousemove', (e) => {
      const mouseX = e.clientX;
      getBtns().forEach(btn => {
        const r = btn.getBoundingClientRect();
        if (!r.width) return;
        const center = r.left + r.width / 2;
        const dist = Math.abs(mouseX - center);
        const falloff = Math.max(0, 1 - dist / INFLUENCE);
        const scale = 1 + falloff * (MAX_SCALE - 1);
        btn.style.transform = `scale(${scale.toFixed(3)})`;
        btn.style.zIndex = falloff > 0.05 ? '10' : '1';
      });
    });
    nav.addEventListener('mouseleave', () => {
      getBtns().forEach(btn => { btn.style.transform = ''; btn.style.zIndex = ''; });
    });
  });
}
initDockMagnify();

// ── DOCK TOOLTIP (balão global, fora da barra, para nunca ser cortado) ──
function initDockTooltips() {
  let tip = document.getElementById('dock-tooltip-global');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'dock-tooltip-global';
    tip.className = 'dock-tooltip-global';
    document.body.appendChild(tip);
  }
  const posicionar = (btn) => {
    const r = btn.getBoundingClientRect();
    tip.style.left = (r.left + r.width / 2) + 'px';
    tip.style.top  = r.top + 'px';
  };
  document.querySelectorAll('.tab-nav .tab-btn').forEach(btn => {
    const labelEl = btn.querySelector('.dock-label');
    const texto = labelEl ? labelEl.textContent : '';
    btn.addEventListener('mouseenter', () => {
      tip.textContent = texto;
      posicionar(btn);
      tip.classList.add('show');
    });
    btn.addEventListener('mousemove', () => posicionar(btn));
    btn.addEventListener('mouseleave', () => tip.classList.remove('show'));
    btn.addEventListener('click', () => tip.classList.remove('show'));
  });
}
initDockTooltips();

// ── REGISTRO ──
let regDataSel = getHoje();
function atualizarDataRegistro() {
  regDataSel = getHoje();
  const picker = document.getElementById('reg-data-escolhida');
  if (picker) picker.value = regDataSel;
  carregarCamposData(regDataSel);
}
function carregarCamposData(dateStr) {
  regDataSel = dateStr;
  const d = new Date(dateStr+'T12:00:00');
  document.getElementById('reg-dia-num').textContent = d.getDate();
  document.getElementById('reg-weekday').textContent = getDiaSemana(dateStr);
  document.getElementById('reg-date-full').textContent = d.toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'});
  const badge = document.getElementById('reg-editando-badge');
  if (badge) badge.style.display = dateStr!==getHoje()?'block':'none';
  const btn = document.getElementById('btn-salvar-dia');
  const errEl = document.getElementById('reg-error');
  if (dateStr>DATA_ENCERRAMENTO) {
    btn.disabled=true; btn.style.opacity='0.4'; btn.textContent='⛔ Campanha Encerrada';
    errEl.textContent='Campanha encerrada em '+formatarData(DATA_ENCERRAMENTO)+'.'; errEl.style.display='block';
  } else {
    btn.disabled=false; btn.style.opacity='1';
    btn.textContent = dateStr!==getHoje()?'✏️ SALVAR EDIÇÃO':'💾 SALVAR DIA';
    errEl.style.display='none';
  }
  ['reg-ofertas','reg-vista','reg-prazo','reg-oracoes','reg-horas','reg-estudos','reg-obs'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  if (!currentUser) return;
  const ex = getRegsUser(currentUser.id).find(r=>r.data===dateStr);
  if (ex) {
    document.getElementById('reg-ofertas').value = ex.ofertas||'';
    document.getElementById('reg-vista').value   = ex.vista||'';
    document.getElementById('reg-prazo').value   = ex.prazo||'';
    document.getElementById('reg-oracoes').value = ex.oracoes||'';
    document.getElementById('reg-horas').value   = ex.horas||'';
    document.getElementById('reg-estudos').value = ex.estudos||'';
    document.getElementById('reg-obs').value     = ex.obs||'';
  }
}
document.getElementById('reg-data-escolhida').addEventListener('change', function(){ carregarCamposData(this.value); });
document.getElementById('btn-reg-hoje').addEventListener('click', ()=>carregarCamposData(getHoje()));

// ── SUB-ABAS: Registro Diário ↔ Devolução de Material ↔ Justificar Dia ──
function mostrarSubAbaRegistro(aba) {
  const abas = ['diario','devolucao','justificar','estudo'];
  abas.forEach(a => {
    document.getElementById('regsub-btn-'+a).classList.toggle('active', a===aba);
    document.getElementById('regsub-'+a).style.display = (a===aba)?'block':'none';
  });
  if (aba === 'devolucao') renderDevolucaoUI();
  if (aba === 'justificar') renderJustificarUI();
  if (aba === 'estudo') renderListaEstudosColportor();
}
document.getElementById('regsub-btn-diario').addEventListener('click', () => mostrarSubAbaRegistro('diario'));
document.getElementById('regsub-btn-devolucao').addEventListener('click', () => mostrarSubAbaRegistro('devolucao'));
document.getElementById('regsub-btn-justificar').addEventListener('click', () => mostrarSubAbaRegistro('justificar'));
document.getElementById('regsub-btn-estudo').addEventListener('click', () => mostrarSubAbaRegistro('estudo'));

// ── DEVOLUÇÃO DE MATERIAL ──
function calcularTotalDevolucaoUI() {
  let total = 0;
  document.querySelectorAll('#dev-categorias [data-dev-qtd]').forEach(inp=>{
    const qtd = parseInt(inp.value)||0;
    const preco = parseFloat(inp.getAttribute('data-preco'))||0;
    total += qtd*preco;
  });
  const el = document.getElementById('dev-total-calculado');
  if (el) el.textContent = fmtMoeda(total);
  return total;
}

// ── LISTA DETALHADA DA DEVOLUÇÃO (compartilhada entre colportor e admin) ──
function montarListaDevolucaoHTML(itens, corAcento) {
  corAcento = corAcento || '#FF8A65';
  if (!itens || !itens.length) {
    return `<div style="font-size:12px;color:var(--texto3);text-align:center;padding:12px;">Nenhum material registrado para devolução.</div>`;
  }
  const linhas = itens.map(it => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid rgba(16,26,51,0.06);">
      <div style="flex:1;min-width:150px;font-size:12px;color:var(--texto);font-weight:600;">${it.nome}</div>
      <div style="font-size:12px;color:var(--texto3);font-family:var(--num-font);white-space:nowrap;">${it.qtd}x ${fmtMoeda(it.preco)}</div>
      <div style="font-size:13px;font-weight:800;font-family:var(--num-font);color:${corAcento};white-space:nowrap;">${fmtMoeda(it.subtotal)}</div>
    </div>`).join('');
  const total = itens.reduce((s,it)=>s+(it.subtotal||0),0);
  return `${linhas}
    <div style="display:flex;justify-content:space-between;align-items:center;padding-top:10px;margin-top:6px;">
      <span style="font-size:12px;font-weight:700;color:var(--texto2);">Total</span>
      <span style="font-size:15px;font-weight:800;font-family:var(--num-font);color:${corAcento};">${fmtMoeda(total)}</span>
    </div>`;
}

document.getElementById('btn-ver-lista-dev').addEventListener('click', function(){
  const cont = document.getElementById('dev-lista-detalhe');
  const abrindo = cont.style.display === 'none';
  if (abrindo) {
    const salvo = getDevolucaoUser(currentUser.id);
    cont.innerHTML = montarListaDevolucaoHTML(salvo ? salvo.itens : [], '#FF8A65');
    cont.style.display = 'block';
    this.textContent = '🔼 Ocultar lista de material';
  } else {
    cont.style.display = 'none';
    this.textContent = '👁️ Ver lista de material';
  }
});

function renderDevolucaoUI() {
  if (!currentUser) return;
  const salvo = getDevolucaoUser(currentUser.id);
  const qtdsSalvas = {};
  if (salvo && Array.isArray(salvo.itens)) {
    salvo.itens.forEach(it => { qtdsSalvas[it.nome] = it.qtd; });
  }

  document.getElementById('dev-categorias').innerHTML = TABELA_DEVOLUCAO.map(cat => `
    <div style="margin-bottom:18px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--ouro-claro);font-weight:700;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(255,177,0,0.15);">${cat.categoria}</div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${cat.itens.map((it,i) => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--bg-card2);border-radius:8px;padding:8px 12px;flex-wrap:wrap;">
            <div style="flex:1;min-width:180px;">
              <div style="font-size:12px;color:var(--texto);font-weight:600;">${it.nome}</div>
              <div style="font-size:11px;color:var(--texto3);font-family:var(--num-font);">${fmtMoeda(it.preco)} (c/ dízimo)</div>
            </div>
            <input type="number" min="0" value="${qtdsSalvas[it.nome]||0}" data-dev-qtd data-preco="${it.preco}" data-nome="${it.nome.replace(/"/g,'&quot;')}"
              style="width:70px;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,177,0,0.25);background:rgba(16,26,51,0.04);color:var(--branco);font-family:var(--num-font);font-size:13px;text-align:center;outline:none;">
          </div>`).join('')}
      </div>
    </div>`).join('');

  document.querySelectorAll('#dev-categorias [data-dev-qtd]').forEach(inp=>{
    inp.addEventListener('input', calcularTotalDevolucaoUI);
  });
  calcularTotalDevolucaoUI();

  document.getElementById('dev-total-atual').textContent = salvo && salvo.total>0 ? fmtMoeda(salvo.total) : 'R$ 0,00';
  const atEl = document.getElementById('dev-atualizado-em');
  atEl.textContent = salvo && salvo.atualizadoEm ? `Última atualização: ${formatarData(salvo.atualizadoEm)}` : 'Ainda não registrado';

  const listaCont = document.getElementById('dev-lista-detalhe');
  const btnVerLista = document.getElementById('btn-ver-lista-dev');
  if (listaCont) { listaCont.style.display = 'none'; listaCont.innerHTML = ''; }
  if (btnVerLista) btnVerLista.textContent = '👁️ Ver lista de material';
}

document.getElementById('btn-salvar-devolucao').addEventListener('click', async () => {
  if (!currentUser) return;
  const msg = document.getElementById('dev-msg');
  const itens = [];
  document.querySelectorAll('#dev-categorias [data-dev-qtd]').forEach(inp=>{
    const qtd = parseInt(inp.value)||0;
    if (qtd>0) {
      itens.push({ nome: inp.getAttribute('data-nome'), preco: parseFloat(inp.getAttribute('data-preco'))||0, qtd, subtotal: qtd*(parseFloat(inp.getAttribute('data-preco'))||0) });
    }
  });
  const total = itens.reduce((s,it)=>s+it.subtotal,0);
  try {
    await setDoc(doc(db,'devolucoes',currentUser.id), {
      colportorNome: currentUser.nome,
      campanhaId: currentUser.campanhaId,
      itens,
      total,
      atualizadoEm: getHoje(),
    });
    document.getElementById('dev-total-atual').textContent = fmtMoeda(total);
    document.getElementById('dev-atualizado-em').textContent = `Última atualização: ${formatarData(getHoje())}`;
    const listaCont = document.getElementById('dev-lista-detalhe');
    if (listaCont && listaCont.style.display !== 'none') {
      listaCont.innerHTML = montarListaDevolucaoHTML(itens, '#FF8A65');
    }
    msg.textContent = '✅ Devolução salva com sucesso!';
    msg.style.color = 'var(--ouro-claro)';
    msg.style.display = 'block';
    mostrarToast('Devolução atualizada.');
  } catch (e) {
    msg.textContent = 'Erro ao salvar a devolução. Tente novamente.';
    msg.style.color = 'var(--danger)';
    msg.style.display = 'block';
  }
});

document.getElementById('btn-salvar-dia').addEventListener('click', async ()=>{
  const err = document.getElementById('reg-error');
  const suc = document.getElementById('reg-success');
  err.style.display='none'; suc.style.display='none';
  if (!currentUser) { err.textContent='Sessão expirada.'; err.style.display='block'; return; }
  if (regDataSel>DATA_ENCERRAMENTO) { err.textContent='Campanha encerrada.'; err.style.display='block'; return; }
  try {
    showSyncStatus('💾 Salvando...','saving');
    // Use composite key userId_data as doc id to prevent duplicates
    const regId = currentUser.id+'_'+regDataSel;
    const reg = {
      id: regId, userId: currentUser.id, data: regDataSel, campanhaId: currentUser.campanhaId,
      ofertas: Math.max(0, parseInt(document.getElementById('reg-ofertas').value)||0),
      vista:   Math.max(0, moedaParaFloat(document.getElementById('reg-vista').value)),
      prazo:   Math.max(0, moedaParaFloat(document.getElementById('reg-prazo').value)),
      oracoes: Math.max(0, parseInt(document.getElementById('reg-oracoes').value)||0),
      horas:   Math.max(0, parseFloat(document.getElementById('reg-horas').value)||0),
      estudos: Math.max(0, parseInt(document.getElementById('reg-estudos').value)||0),
      obs:     document.getElementById('reg-obs').value||'',
    };
    await setDoc(doc(db,'registros',regId), reg);
    showSyncStatus('✅ Salvo!','saved');
    const isEdit = regDataSel!==getHoje();
    suc.textContent = (isEdit?'✅ Edição salva para '+formatarData(regDataSel):'✅ Dia salvo!') + ' — À vista: '+fmtMoeda(reg.vista);
    suc.style.display='block';
  } catch(e) { err.textContent='Erro: '+e.message; err.style.display='block'; showSyncStatus('❌ Erro','error'); }
});

// ── JUSTIFICAR DIA ──
function carregarJustificativaExistente() {
  if (!currentUser) return;
  const data = document.getElementById('just-data').value;
  const motivoEl = document.getElementById('just-motivo');
  const errEl = document.getElementById('just-error');
  const sucEl = document.getElementById('just-success');
  sucEl.style.display = 'none';
  errEl.style.display = 'none';
  const ex = getRegsUser(currentUser.id).find(r=>r.data===data);
  if (ex && ex.justificado) {
    motivoEl.value = ex.motivoJustificativa || '';
  } else if (ex) {
    motivoEl.value = '';
    errEl.textContent = '⚠️ Já existe um registro de trabalho normal para este dia. Salvar aqui vai substituir esse registro pela justificativa.';
    errEl.style.display = 'block';
  } else {
    motivoEl.value = '';
  }
}

function renderJustificarUI() {
  if (!currentUser) return;
  const dataInput = document.getElementById('just-data');
  if (!dataInput.value) dataInput.value = getHoje();
  carregarJustificativaExistente();
}

document.getElementById('just-data').addEventListener('change', carregarJustificativaExistente);

document.getElementById('btn-salvar-justificativa').addEventListener('click', async () => {
  const err = document.getElementById('just-error');
  const suc = document.getElementById('just-success');
  suc.style.display = 'none';
  if (!currentUser) { err.textContent='Sessão expirada.'; err.style.display='block'; return; }
  const data = document.getElementById('just-data').value;
  const motivo = document.getElementById('just-motivo').value.trim();
  if (!data) { err.textContent='Selecione uma data.'; err.style.display='block'; return; }
  if (data > DATA_ENCERRAMENTO) { err.textContent='Campanha encerrada em '+formatarData(DATA_ENCERRAMENTO)+'.'; err.style.display='block'; return; }
  if (!motivo) { err.textContent='Escreva o motivo da justificativa.'; err.style.display='block'; return; }
  try {
    showSyncStatus('💾 Salvando...','saving');
    const regId = currentUser.id+'_'+data;
    const reg = {
      id: regId, userId: currentUser.id, data, campanhaId: currentUser.campanhaId,
      ofertas: 0, vista: 0, prazo: 0, oracoes: 0, horas: 0, estudos: 0, obs: '',
      justificado: true, motivoJustificativa: motivo,
    };
    await setDoc(doc(db,'registros',regId), reg);
    showSyncStatus('✅ Salvo!','saved');
    err.style.display = 'none';
    suc.textContent = '✅ Justificativa salva para ' + formatarData(data) + '.';
    suc.style.display = 'block';
  } catch(e) {
    err.textContent = 'Erro: ' + e.message; err.style.display='block'; showSyncStatus('❌ Erro','error');
  }
});

// ── ESTUDO BÍBLICO ──
function getEstudosUser(uid) {
  return liveEstudos.filter(e => e.colportorId === uid).sort((a,b)=>(b.criadoEm||'').localeCompare(a.criadoEm||''));
}

function renderListaEstudosColportor() {
  if (!currentUser) return;
  const lista = getEstudosUser(currentUser.id);
  const cont = document.getElementById('lista-estudos-col');
  if (!lista.length) { cont.innerHTML = '<div style="font-size:12px;color:var(--texto3);text-align:center;padding:16px;">Nenhum estudo registrado ainda.</div>'; return; }
  cont.innerHTML = lista.map(e => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--bg-card2);border-radius:10px;padding:10px 14px;margin-bottom:8px;flex-wrap:wrap;">
      <div style="flex:1;min-width:180px;">
        <div style="font-size:13px;font-weight:700;color:var(--branco);">${escapeHtml(e.nome)}</div>
        <div style="font-size:11px;color:var(--texto3);">📱 ${escapeHtml(e.telefone)||'—'} · 📍 ${escapeHtml(e.cidade)||'—'}</div>
      </div>
      <span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:100px;text-transform:uppercase;letter-spacing:0.5px;${e.presenca==='com'?'background:rgba(76,175,80,0.15);color:#81C784;border:1px solid rgba(76,175,80,0.3);':'background:rgba(239,83,80,0.12);color:#EF9090;border:1px solid rgba(239,83,80,0.3);'}">${e.presenca==='com'?'Com presença adv.':'Sem presença adv.'}</span>
      <button data-del-est="${e.id}" style="padding:5px 10px;border-radius:7px;border:1px solid rgba(239,83,80,0.3);background:rgba(239,83,80,0.08);color:#EF9090;font-family:Inter,sans-serif;font-size:11px;font-weight:700;cursor:pointer;">🗑️</button>
    </div>`).join('');
  cont.querySelectorAll('[data-del-est]').forEach(b=>b.addEventListener('click', function(){
    const id = this.getAttribute('data-del-est');
    mostrarConfirm('Apagar este estudo?','Esta ação não pode ser desfeita.', async ()=>{
      await deleteDoc(doc(db,'estudosBiblicos',id));
      mostrarToast('Estudo apagado.');
    });
  }));
}

document.getElementById('btn-salvar-estudo').addEventListener('click', async () => {
  const err = document.getElementById('est-error');
  const suc = document.getElementById('est-success');
  suc.style.display = 'none'; err.style.display = 'none';
  if (!currentUser) { err.textContent='Sessão expirada.'; err.style.display='block'; return; }
  const nome = document.getElementById('est-nome').value.trim();
  const telefone = document.getElementById('est-telefone').value.trim();
  const cidade = document.getElementById('est-cidade').value.trim();
  const presenca = document.getElementById('est-presenca').value;
  if (!nome) { err.textContent='Informe o nome do estudante.'; err.style.display='block'; return; }
  if (!telefone) { err.textContent='Informe o telefone.'; err.style.display='block'; return; }
  if (!cidade) { err.textContent='Informe a cidade.'; err.style.display='block'; return; }
  if (!presenca) { err.textContent='Selecione se a cidade tem presença adventista.'; err.style.display='block'; return; }
  try {
    showSyncStatus('💾 Salvando...','saving');
    await addDoc(collection(db,'estudosBiblicos'), {
      colportorId: currentUser.id,
      colportorNome: currentUser.nome,
      campanhaId: currentUser.campanhaId,
      nome, telefone, cidade, presenca,
      criadoEm: getHoje(),
    });
    showSyncStatus('✅ Salvo!','saved');
    suc.textContent = '✅ Estudo registrado com sucesso!';
    suc.style.display = 'block';
    document.getElementById('est-nome').value = '';
    document.getElementById('est-telefone').value = '';
    document.getElementById('est-cidade').value = '';
    document.getElementById('est-presenca').value = '';
    renderListaEstudosColportor();
  } catch(e) {
    err.textContent = 'Erro: ' + e.message; err.style.display='block'; showSyncStatus('❌ Erro','error');
  }
});

// ── ESTUDOS BÍBLICOS (ADMIN) ──
function renderTabelaEstudosAdmin() {
  const buscaEl = document.getElementById('estudos-busca');
  const busca = (buscaEl && buscaEl.value || '').toLowerCase();
  const lista = [...liveEstudos]
    .filter(e => !busca || (e.nome||'').toLowerCase().includes(busca) || (e.colportorNome||'').toLowerCase().includes(busca) || (e.cidade||'').toLowerCase().includes(busca))
    .sort((a,b)=>(b.criadoEm||'').localeCompare(a.criadoEm||''));
  const totalEl = document.getElementById('estudos-total-count');
  if (totalEl) totalEl.textContent = liveEstudos.length;
  const tbody = document.getElementById('tabela-estudos-body');
  if (!tbody) return;
  if (!lista.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--texto3)">Nenhum estudo registrado.</td></tr>'; return; }
  tbody.innerHTML = lista.map(e => `<tr>
      <td style="font-weight:700">${escapeHtml(e.nome)}</td>
      <td style="font-family:var(--num-font);font-size:12px">${escapeHtml(e.telefone)||'—'}</td>
      <td>${escapeHtml(e.cidade)||'—'}</td>
      <td><span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:100px;text-transform:uppercase;letter-spacing:0.5px;${e.presenca==='com'?'background:rgba(76,175,80,0.15);color:#81C784;border:1px solid rgba(76,175,80,0.3);':'background:rgba(239,83,80,0.12);color:#EF9090;border:1px solid rgba(239,83,80,0.3);'}">${e.presenca==='com'?'Com presença adv.':'Sem presença adv.'}</span></td>
      <td style="color:var(--ouro-claro);font-weight:700;">${escapeHtml(e.colportorNome)||'—'}</td>
      <td style="font-size:12px;color:var(--texto3);">${e.criadoEm?formatarData(e.criadoEm):'—'}</td>
      <td><button data-del-est-adm="${e.id}" style="padding:6px 10px;border-radius:7px;border:1px solid rgba(239,83,80,0.3);background:rgba(239,83,80,0.08);color:#EF9090;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;">🗑️</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-del-est-adm]').forEach(b=>b.addEventListener('click', function(){
    const id = this.getAttribute('data-del-est-adm');
    mostrarConfirm('Apagar este estudo?','Esta ação não pode ser desfeita.', async ()=>{
      await deleteDoc(doc(db,'estudosBiblicos',id));
      mostrarToast('Estudo apagado.');
    });
  }));
}
const buscaEstudosInput = document.getElementById('estudos-busca');
if (buscaEstudosInput) buscaEstudosInput.addEventListener('input', renderTabelaEstudosAdmin);

// ── HISTÓRICO FILTROS (agora unificados com o Resumo Geral, ver renderResumoHistorico) ──

// ── PAINEL COLPORTOR ──
function renderPainel() {
  if (!currentUser) return;
  const regs = getRegsUser(currentUser.id);
  const hoje = getHoje();
  const rHoje = regs.find(r=>r.data===hoje);
  const totalVista = regs.reduce((s,r)=>s+(r.vista||0),0);
  const meta  = currentUser.meta;
  const falta = Math.max(0, meta-totalVista);
  const pct   = meta>0 ? Math.min(100,(totalVista/meta)*100) : 0;
  document.getElementById('painel-meta').textContent    = fmtMoeda(meta);
  document.getElementById('painel-vendido').textContent  = fmtMoeda(totalVista);
  document.getElementById('painel-falta').textContent   = fmtMoeda(falta);
  document.getElementById('painel-pct').textContent     = pct.toFixed(1)+'%';
  document.getElementById('painel-bar').style.width     = pct+'%';
  document.getElementById('painel-dia-num').textContent = contarDiasTrabalhados(regs);
  const enc = new Date(DATA_ENCERRAMENTO+'T23:59:59');
  const dr  = Math.max(0,Math.ceil((enc-new Date())/(1000*60*60*24)));
  const elDR = document.getElementById('painel-dias-restantes');
  if (elDR) { elDR.textContent=dr===0?'⛔ Encerrada':dr; elDR.style.color=dr<=7?'var(--danger)':dr<=15?'#FFC94D':'var(--ouro-claro)'; }
  const elCard = document.getElementById('painel-dias-card');
  if (elCard) { elCard.textContent=dr===0?'⛔':dr; elCard.style.color=dr<=7?'var(--danger)':dr<=15?'#FFC94D':'var(--branco)'; }
  document.getElementById('painel-ofertas-hoje').textContent = rHoje?rHoje.ofertas:'—';
  document.getElementById('painel-vendas-hoje').textContent  = rHoje?fmtMini(rHoje.vista||0):'—';
  document.getElementById('painel-oracoes-hoje').textContent = rHoje?rHoje.oracoes:'—';
  document.getElementById('painel-horas-hoje').textContent   = rHoje?fmtHoras(rHoje.horas):'—';
  document.getElementById('painel-ofertas-total').textContent = regs.reduce((s,r)=>s+(r.ofertas||0),0);
  document.getElementById('painel-oracoes-total').textContent = regs.reduce((s,r)=>s+(r.oracoes||0),0);
  document.getElementById('painel-horas-total').textContent   = fmtHoras(regs.reduce((s,r)=>s+(r.horas||0),0));
  document.getElementById('painel-estudos-total').textContent = regs.reduce((s,r)=>s+(r.estudos||0),0);
  const ult = [...regs].reverse().slice(0,5);
  const cont = document.getElementById('ultimos-registros');
  if (!ult.length) { cont.innerHTML='<div class="empty-state"><div class="empty-icon">📝</div><div>Registre seu primeiro dia!</div></div>'; return; }
  cont.innerHTML='<div class="table-wrap"><table class="historico-table"><thead><tr><th>Data</th><th>À Vista</th><th>Ofertas</th><th>Orações</th></tr></thead><tbody>'
    +ult.map(r=>`<tr><td>${formatarData(r.data)}<br><span style="font-size:10px;color:var(--texto3)">${getDiaSemana(r.data).slice(0,3)}</span></td><td style="color:var(--ouro-claro);font-family:var(--num-font);font-weight:700">${fmtMini(r.vista||0)}</td><td>${r.ofertas||0}</td><td>${r.oracoes||0}</td></tr>`).join('')
    +'</tbody></table></div>';
}

// ── HISTÓRICO COLPORTOR ──
function renderHistorico() {
  if (!currentUser) return;
  let regs = filtrarRegsPorPeriodo(getRegsUser(currentUser.id), perfilFiltro);
  const tbody = document.getElementById('historico-body');
  if (!regs.length) { tbody.innerHTML='<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--texto3)">Nenhum registro encontrado.</td></tr>'; return; }
  tbody.innerHTML = [...regs].reverse().map(r=>r.justificado ? `
    <tr style="background:rgba(180,83,9,0.06);">
      <td><div style="font-weight:700">${formatarData(r.data)}</div><div style="font-size:11px;color:var(--texto3)">${getDiaSemana(r.data).slice(0,3)}</div></td>
      <td colspan="6" style="color:var(--texto2);font-style:italic;">
        <span style="display:inline-block;background:rgba(180,83,9,0.15);border:1px solid rgba(180,83,9,0.3);border-radius:100px;padding:2px 10px;font-size:10px;font-weight:700;color:#FFB100;text-transform:uppercase;letter-spacing:0.5px;margin-right:8px;">📢 Justificado</span>
        ${escapeHtml(r.motivoJustificativa)}
      </td>
      <td>
        <div style="display:flex;gap:6px;">
          <button data-edit-just="${r.data}" style="padding:5px 10px;border-radius:7px;border:1px solid rgba(255,177,0,0.35);background:rgba(255,177,0,0.1);color:var(--ouro-claro);font-family:Inter,sans-serif;font-size:11px;font-weight:700;cursor:pointer;">✏️</button>
          <button data-del="${r.id}" style="padding:5px 10px;border-radius:7px;border:1px solid rgba(239,83,80,0.3);background:rgba(239,83,80,0.08);color:#EF9090;font-family:Inter,sans-serif;font-size:11px;font-weight:700;cursor:pointer;">🗑️</button>
        </div>
      </td>
    </tr>` : `
    <tr>
      <td><div style="font-weight:700">${formatarData(r.data)}</div><div style="font-size:11px;color:var(--texto3)">${getDiaSemana(r.data).slice(0,3)}</div></td>
      <td>${r.ofertas||0}</td>
      <td style="color:var(--ouro-claro);font-family:var(--num-font);font-weight:700">${fmtMini(r.vista||0)}</td>
      <td style="color:#3D5DF2;font-family:var(--num-font);font-weight:600">${fmtMini(r.prazo||0)}</td>
      <td>${r.oracoes||0}</td>
      <td>${r.horas||0}h</td>
      <td>${r.estudos||0}</td>
      <td>
        <div style="display:flex;gap:6px;">
          <button data-edit="${r.data}" style="padding:5px 10px;border-radius:7px;border:1px solid rgba(255,177,0,0.35);background:rgba(255,177,0,0.1);color:var(--ouro-claro);font-family:Inter,sans-serif;font-size:11px;font-weight:700;cursor:pointer;">✏️</button>
          <button data-del="${r.id}" style="padding:5px 10px;border-radius:7px;border:1px solid rgba(239,83,80,0.3);background:rgba(239,83,80,0.08);color:#EF9090;font-family:Inter,sans-serif;font-size:11px;font-weight:700;cursor:pointer;">🗑️</button>
        </div>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',function(){
    const data=this.getAttribute('data-edit');
    abrirTabCol('tab-registro',document.getElementById('tbtn-registro'));
    setTimeout(()=>carregarCamposData(data),100);
  }));
  tbody.querySelectorAll('[data-edit-just]').forEach(b=>b.addEventListener('click',function(){
    const data=this.getAttribute('data-edit-just');
    abrirTabCol('tab-registro',document.getElementById('tbtn-registro'));
    setTimeout(()=>{
      mostrarSubAbaRegistro('justificar');
      document.getElementById('just-data').value = data;
      carregarJustificativaExistente();
    },100);
  }));
  tbody.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',function(){
    const id=this.getAttribute('data-del');
    mostrarConfirm('Apagar este registro?','Esta ação não pode ser desfeita.',async()=>{
      await deleteDoc(doc(db,'registros',id));
      mostrarToast('Registro apagado.');
    });
  }));
}

// ── RESUMO GERAL (Bolsa de Estudos + filtros + resultados + médias) ──
function renderResumoHistorico() {
  if (!currentUser) return;
  const todosRegs = getRegsUser(currentUser.id);
  const regs      = filtrarRegsPorPeriodo(todosRegs, perfilFiltro);

  const vista  = regs.reduce((s,r)=>s+(r.vista||0),0);
  const prazo  = regs.reduce((s,r)=>s+(r.prazo||0),0);
  const medPeriodo = calcMediasDiarias(regs);

  const vistaTotal = todosRegs.reduce((s,r)=>s+(r.vista||0),0);
  const meta   = currentUser.meta;
  const falta  = Math.max(0, meta - vistaTotal);
  const pct    = meta>0 ? Math.min(100,(vistaTotal/meta)*100) : 0;
  const prazoTotal = todosRegs.reduce((s,r)=>s+(r.prazo||0),0);

  const dataIniVal = perfilDataIni || AGENDA_INICIO;
  const dataFimVal = perfilDataFim || getHoje();
  const labelPeriodo = perfilFiltro==='datas'
    ? `${formatarData(dataIniVal)} a ${formatarData(dataFimVal)}`
    : (perfilFiltro==='campanha'?'Campanha completa':perfilFiltro==='semana'?'Últimos 7 dias':perfilFiltro==='15dias'?'Últimos 15 dias':'Este mês');

  document.getElementById('colhist-resumo').innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--borda);border-radius:16px;padding:20px;margin-bottom:16px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:#FF6B6B;font-weight:700;margin-bottom:16px;">🎯 Bolsa de Estudos</div>
      <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:center;">
        <div style="position:relative;width:140px;height:140px;flex-shrink:0;">
          <canvas id="colhist-pizza" width="140" height="140"></canvas>
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
            <div style="font-size:24px;font-weight:800;font-family:var(--num-font);color:var(--ouro-claro);">${pct.toFixed(1)}%</div>
            <div style="font-size:9px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;">Alcançado</div>
          </div>
        </div>
        <div style="flex:1;min-width:220px;display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(76,175,80,0.08);border-left:3px solid #4CAF50;border-radius:8px;padding:10px 14px;">
            <span style="font-size:12px;color:var(--texto2);font-weight:600;">✅ Já vendeu (à vista)</span>
            <span style="font-family:var(--num-font);font-weight:800;color:#4CAF50;">${fmtMini(vistaTotal)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,59,59,0.06);border-left:3px solid var(--danger);border-radius:8px;padding:10px 14px;">
            <span style="font-size:12px;color:var(--texto2);font-weight:600;">⬜ Falta alcançar</span>
            <span style="font-family:var(--num-font);font-weight:800;color:var(--danger);">${fmtMini(falta)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,177,0,0.06);border-left:3px solid var(--ouro);border-radius:8px;padding:10px 14px;">
            <span style="font-size:12px;color:var(--texto2);font-weight:600;">🎯 Meta total</span>
            <span style="font-family:var(--num-font);font-weight:800;color:var(--ouro-claro);">${fmtMini(meta)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(180,83,9,0.06);border-left:3px solid var(--azul-medio);border-radius:8px;padding:10px 14px;">
            <span style="font-size:12px;color:var(--texto2);font-weight:600;">📋 No Pedido</span>
            <span style="font-family:var(--num-font);font-weight:800;color:var(--azul-claro);">${fmtMini(prazoTotal)}</span>
          </div>
        </div>
      </div>
    </div>

    <div style="background:rgba(255,177,0,0.05);border:1px solid rgba(255,177,0,0.2);border-radius:12px;padding:14px 16px;margin-bottom:16px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--texto3);font-weight:700;margin-bottom:10px;">📊 Filtrar período</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;" id="colhist-filtros">
        ${['campanha','semana','15dias','mes','datas'].map(p=>`
          <button data-cfiltro="${p}" style="padding:6px 12px;border-radius:100px;border:1px solid ${perfilFiltro===p?'var(--ouro)':'rgba(255,177,0,0.12)'};background:${perfilFiltro===p?'linear-gradient(135deg,#FFB100,#B45309)':'transparent'};color:${perfilFiltro===p?'#000':'var(--texto3)'};font-family:Inter,sans-serif;font-size:11px;font-weight:700;cursor:pointer;transition:all 0.15s;">
            ${p==='campanha'?'📅 Completo':p==='semana'?'7 dias':p==='15dias'?'15 dias':p==='mes'?'Este mês':'📆 Personalizado'}
          </button>`).join('')}
      </div>
      <div id="colhist-datas-custom" style="display:${perfilFiltro==='datas'?'flex':'none'};gap:10px;flex-wrap:wrap;align-items:center;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:11px;color:var(--texto3);font-weight:600;">De:</span>
          <input type="date" id="colhist-data-ini" value="${dataIniVal}" min="${AGENDA_INICIO}" max="${DATA_ENCERRAMENTO}"
            style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,177,0,0.3);background:rgba(16,26,51,0.04);color:var(--branco);font-family:'Inter',sans-serif;font-size:12px;outline:none;">
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:11px;color:var(--texto3);font-weight:600;">Até:</span>
          <input type="date" id="colhist-data-fim" value="${dataFimVal}" min="${AGENDA_INICIO}" max="${DATA_ENCERRAMENTO}"
            style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,177,0,0.3);background:rgba(16,26,51,0.04);color:var(--branco);font-family:'Inter',sans-serif;font-size:12px;outline:none;">
        </div>
        <button id="colhist-btn-filtrar" style="padding:6px 14px;border-radius:8px;border:none;background:linear-gradient(135deg,#FFB100,#B45309);color:#000;font-family:'Inter',sans-serif;font-size:12px;font-weight:700;cursor:pointer;">Filtrar</button>
      </div>
    </div>

    <div style="background:rgba(255,177,0,0.05);border:1px solid rgba(255,177,0,0.15);border-radius:14px;padding:16px;margin-bottom:16px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--ouro-claro);font-weight:700;margin-bottom:12px;">📈 ${labelPeriodo} — Resultados</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;">
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--ouro);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">💰 À Vista</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:var(--ouro-claro);">${fmtMini(vista)}</div>
        </div>
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--azul-medio);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">📋 No Pedido</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:var(--azul-claro);">${fmtMini(prazo)}</div>
        </div>
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--azul-medio);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">📦 Ofertas</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:var(--azul-claro);">${regs.reduce((s,r)=>s+(r.ofertas||0),0)}</div>
        </div>
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--amarelo);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">🙏 Orações</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:var(--amarelo);">${regs.reduce((s,r)=>s+(r.oracoes||0),0)}</div>
        </div>
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--laranja);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">⏰ Horas</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:#FFAB40;">${fmtHoras(regs.reduce((s,r)=>s+(r.horas||0),0))}</div>
        </div>
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--ouro);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">📅 Dias</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:var(--ouro-claro);">${contarDiasTrabalhados(regs)}</div>
        </div>
      </div>
    </div>

    <div style="background:rgba(255,177,0,0.05);border:1px solid rgba(255,177,0,0.15);border-radius:14px;padding:16px;margin-bottom:20px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--ouro-claro);font-weight:700;margin-bottom:12px;">
        📊 Médias Diárias — ${labelPeriodo} <span style="color:var(--texto3);font-weight:500;text-transform:none;letter-spacing:0;">(por dia registrado)</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;">
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--ouro);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">💰 Média Vendas/dia</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:var(--ouro-claro);">${fmtMini(medPeriodo.mediaVendas)}</div>
        </div>
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--azul-medio);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">📦 Média Ofertas/dia</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:var(--azul-claro);">${medPeriodo.mediaOfertas.toFixed(1)}</div>
        </div>
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--laranja);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">⏰ Média Horas/dia</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:#FFAB40;">${fmtHoras(medPeriodo.mediaHoras)}</div>
        </div>
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--ouro);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">📅 Dias Trabalhados</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:var(--ouro-claro);">${medPeriodo.dias}</div>
        </div>
      </div>
    </div>`;

  // Donut da Bolsa de Estudos
  setTimeout(()=>{
    destroyChart('colhist-pizza');
    const ctx = document.getElementById('colhist-pizza');
    if (ctx && typeof Chart!=='undefined') {
      const c = pct>=100?'#FFB100':pct>=75?'#FFC94D':pct>=50?'#CC8C00':pct>=25?'#B45309':'#EF5350';
      chartInstances['colhist-pizza'] = new Chart(ctx,{type:'doughnut',data:{datasets:[{data:[vistaTotal,Math.max(0,meta-vistaTotal)],backgroundColor:[c,'rgba(16,26,51,0.06)'],borderColor:['transparent','transparent'],borderWidth:0}]},options:{responsive:false,cutout:'72%',plugins:{legend:{display:false},tooltip:{enabled:false}},animation:{duration:600}}});
    }
  },50);

  // Bind filtros de período
  document.querySelectorAll('[data-cfiltro]').forEach(btn=>{
    btn.addEventListener('click', function(){
      perfilFiltro = this.getAttribute('data-cfiltro');
      const customArea = document.getElementById('colhist-datas-custom');
      if (customArea) customArea.style.display = perfilFiltro==='datas'?'flex':'none';
      if (perfilFiltro !== 'datas') { renderResumoHistorico(); renderHistorico(); }
    });
  });
  const btnFiltrarCol = document.getElementById('colhist-btn-filtrar');
  if (btnFiltrarCol) {
    btnFiltrarCol.addEventListener('click', ()=>{
      perfilDataIni = document.getElementById('colhist-data-ini').value;
      perfilDataFim = document.getElementById('colhist-data-fim').value;
      renderResumoHistorico();
      renderHistorico();
    });
  }
}

document.getElementById('btn-pdf-colhist').addEventListener('click', ()=>{
  if (currentUser) exportarPDFColportor(currentUser.id);
});

// ── GRÁFICOS COLPORTOR ──
function destroyChart(id) { if(chartInstances[id]){chartInstances[id].destroy();delete chartInstances[id];} }
function criarChart(id,type,labels,datasets,opts={}) {
  if (typeof Chart==='undefined') return;
  destroyChart(id); const ctx=document.getElementById(id); if(!ctx) return;
  chartInstances[id]=new Chart(ctx,{type,data:{labels,datasets},options:{responsive:true,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#6E7285',font:{size:11}},grid:{color:'rgba(255,177,0,0.04)'}},y:{ticks:{color:'#6E7285',font:{size:11}},grid:{color:'rgba(255,177,0,0.06)'},beginAtZero:true}},...opts}});
}
// ── FILTRO DE PERÍODO DOS GRÁFICOS (colportor e admin) ──
let graficosColFiltro = 'semana'; // semana | 15dias | 30dias | todo
let graficosAdmFiltro = 'semana';
function filtrarRegsGrafico(regs, filtro) {
  if (filtro === 'todo') return regs;
  const dias = filtro==='semana' ? 7 : filtro==='15dias' ? 15 : filtro==='30dias' ? 30 : 7;
  const hoje = new Date(getHoje()+'T12:00:00');
  const ini = new Date(hoje); ini.setDate(hoje.getDate()-(dias-1));
  return regs.filter(r => new Date(r.data+'T12:00:00') >= ini);
}
function labelFiltroGrafico(filtro) {
  return filtro==='semana' ? 'Última Semana' : filtro==='15dias' ? 'Últimos 15 Dias' : filtro==='30dias' ? 'Últimos 30 Dias' : 'Todo o Período';
}

function renderGraficosColportor() {
  const regs = filtrarRegsGrafico(getRegsUser(currentUser.id), graficosColFiltro);
  const lblEstCol = document.getElementById('graf-estudos-col-label');
  if (lblEstCol) lblEstCol.textContent = `📖 Estudos Bíblicos — ${labelFiltroGrafico(graficosColFiltro)}`;
  const valEstCol = document.getElementById('graf-estudos-col');
  if (valEstCol) valEstCol.textContent = regs.reduce((s,r)=>s+(r.estudos||0),0);
  const L = regs.map(r=>formatarData(r.data).slice(0,5));
  criarChart('chart-vendas-col','line',L,[{data:regs.map(r=>r.vista||0),borderColor:'#FFB100',backgroundColor:'rgba(255,177,0,0.1)',borderWidth:2,fill:true,tension:0.4}]);
  criarChart('chart-ofertas-col','bar',L,[{data:regs.map(r=>r.ofertas||0),backgroundColor:'rgba(255,177,0,0.6)',borderRadius:6}]);
  criarChart('chart-oracoes-col','bar',L,[{data:regs.map(r=>r.oracoes||0),backgroundColor:'rgba(43,79,242,0.55)',borderRadius:6}]);
  criarChart('chart-horas-col','line',L,[{data:regs.map(r=>r.horas||0),borderColor:'#8A5200',backgroundColor:'rgba(192,152,32,0.1)',borderWidth:2,fill:true,tension:0.4}]);
  let ac=0; const metaData=regs.map(r=>{ac+=(r.vista||0);return ac;});
  destroyChart('chart-meta-col');
  const ctx=document.getElementById('chart-meta-col');
  if(ctx&&typeof Chart!=='undefined'){
    chartInstances['chart-meta-col']=new Chart(ctx,{type:'line',data:{labels:L,datasets:[{label:'Acumulado',data:metaData,borderColor:'#FFB100',backgroundColor:'rgba(255,177,0,0.1)',fill:true,tension:0.4,borderWidth:2},{label:'Meta',data:regs.map(()=>currentUser.meta),borderColor:'rgba(16,26,51,0.4)',borderDash:[6,4],borderWidth:2,fill:false,pointRadius:0}]},options:{responsive:true,plugins:{legend:{display:true,labels:{color:'#6E7285',font:{size:11}}}},scales:{x:{ticks:{color:'#6E7285',font:{size:11}},grid:{color:'rgba(255,177,0,0.04)'}},y:{ticks:{color:'#6E7285',font:{size:11},callback:v=>'R$'+(v/1000).toFixed(0)+'k'},grid:{color:'rgba(16,26,51,0.06)'},beginAtZero:true}}}});
  }
}

// ── RELATÓRIO INDIVIDUAL ──
function renderRelatorioIndividual() {
  const regs = getRegsUser(currentUser.id);
  const tv = regs.reduce((s,r)=>s+(r.vista||0),0);
  const tp = regs.reduce((s,r)=>s+(r.prazo||0),0);
  const meta = currentUser.meta;
  const pct = meta>0?(tv/meta*100).toFixed(1):0;
  const med = calcMediasDiarias(regs);
  document.getElementById('relatorio-individual').innerHTML=`
    <div class="section-title" style="margin-bottom:20px">${currentUser.nome} — Relatório Final</div>
    <div class="stats-grid">
      <div class="stat-card green"><div class="stat-label">📅 Dias Trabalhados</div><div class="stat-value">${contarDiasTrabalhados(regs)}</div><div class="stat-sub">até ${formatarData(DATA_ENCERRAMENTO)}</div></div>
      <div class="stat-card blue"><div class="stat-label">⏰ Horas Totais</div><div class="stat-value">${fmtHoras(regs.reduce((s,r)=>s+(r.horas||0),0))}</div></div>
      <div class="stat-card yellow"><div class="stat-label">📦 Ofertas Totais</div><div class="stat-value">${regs.reduce((s,r)=>s+(r.ofertas||0),0)}</div></div>
      <div class="stat-card orange"><div class="stat-label">🙏 Orações Totais</div><div class="stat-value">${regs.reduce((s,r)=>s+(r.oracoes||0),0)}</div></div>
      <div class="stat-card green"><div class="stat-label">💰 Vendas à Vista</div><div class="stat-value" style="font-size:20px">${fmtMini(tv)}</div></div>
      <div class="stat-card blue"><div class="stat-label">📋 No Pedido</div><div class="stat-value" style="font-size:20px">${fmtMini(tp)}</div></div>
      <div class="stat-card orange"><div class="stat-label">📖 Estudos Bíblicos</div><div class="stat-value">${regs.reduce((s,r)=>s+(r.estudos||0),0)}</div></div>
      <div class="stat-card ${parseFloat(pct)>=100?'green':'yellow'}"><div class="stat-label">🎯 Meta Atingida</div><div class="stat-value">${pct}%</div></div>
    </div>
    <div class="progress-wrap mt-16">
      <div class="progress-header"><span class="progress-label">Progresso da Bolsa</span><span class="progress-pct color-green">${pct}%</span></div>
      <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${Math.min(100,parseFloat(pct))}%"></div></div>
    </div>
    <div style="background:rgba(255,177,0,0.05);border:1px solid rgba(255,177,0,0.15);border-radius:14px;padding:16px;margin-top:16px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--ouro-claro);font-weight:700;margin-bottom:12px;">📊 Médias Diárias (por dia trabalhado)</div>
      <div class="stats-grid">
        <div class="stat-card green"><div class="stat-label">💰 Média de Vendas/dia</div><div class="stat-value" style="font-size:18px">${fmtMini(med.mediaVendas)}</div></div>
        <div class="stat-card yellow"><div class="stat-label">📦 Média de Ofertas/dia</div><div class="stat-value">${med.mediaOfertas.toFixed(1)}</div></div>
        <div class="stat-card orange"><div class="stat-label">⏰ Média de Horas/dia</div><div class="stat-value">${fmtHoras(med.mediaHoras)}</div></div>
        <div class="stat-card blue"><div class="stat-label">📅 Dias Trabalhados</div><div class="stat-value">${med.dias}</div></div>
      </div>
    </div>`;
}

// ── ADMIN DASHBOARD ──
// ── DASHBOARD FILTER STATE ──
let dashFiltro    = 'hoje';   // hoje | semana | 15dias | mes | data | periodo
let dashDataSel   = '';       // for 'data' mode
let dashPeriodoIni= '';
let dashPeriodoFim= '';

function getDashRegs() {
  const hoje = getHoje();
  const now  = new Date();
  if (dashFiltro === 'hoje') {
    return liveRegistros.filter(r=>r.data===hoje);
  }
  if (dashFiltro === 'data' && dashDataSel) {
    return liveRegistros.filter(r=>r.data===dashDataSel);
  }
  if (dashFiltro === 'semana') {
    const ini = new Date(now); ini.setDate(now.getDate()-6); ini.setHours(0,0,0,0);
    return liveRegistros.filter(r=>new Date(r.data+'T12:00:00')>=ini);
  }
  if (dashFiltro === '15dias') {
    const ini = new Date(now); ini.setDate(now.getDate()-14); ini.setHours(0,0,0,0);
    return liveRegistros.filter(r=>new Date(r.data+'T12:00:00')>=ini);
  }
  if (dashFiltro === 'mes') {
    const ini = new Date(now.getFullYear(),now.getMonth(),1);
    return liveRegistros.filter(r=>new Date(r.data+'T12:00:00')>=ini);
  }
  if (dashFiltro === 'periodo' && dashPeriodoIni && dashPeriodoFim) {
    return liveRegistros.filter(r=>r.data>=dashPeriodoIni && r.data<=dashPeriodoFim);
  }
  return liveRegistros.filter(r=>r.data===hoje);
}

function getDashLabel() {
  if (dashFiltro==='hoje')    return 'Hoje';
  if (dashFiltro==='semana')  return 'Últimos 7 Dias';
  if (dashFiltro==='15dias')  return 'Últimos 15 Dias';
  if (dashFiltro==='mes')     return 'Este Mês';
  if (dashFiltro==='data' && dashDataSel) return formatarData(dashDataSel);
  if (dashFiltro==='periodo' && dashPeriodoIni && dashPeriodoFim)
    return `${formatarData(dashPeriodoIni)} a ${formatarData(dashPeriodoFim)}`;
  return 'Hoje';
}

function renderAdminDashboard() {
  const rData  = getDashRegs();
  const label  = getDashLabel();

  const vData  = rData.reduce((s,r)=>s+(r.vista||0),0);
  const oData  = rData.reduce((s,r)=>s+(r.ofertas||0),0);
  const orData = rData.reduce((s,r)=>s+(r.oracoes||0),0);
  const hData  = rData.reduce((s,r)=>s+(r.horas||0),0);
  const estData = rData.reduce((s,r)=>s+(r.estudos||0),0);
  const totalAcum = liveRegistros.reduce((s,r)=>s+(r.vista||0),0);

  // Update card labels
  const lv  = document.getElementById('dash-label-vendas');
  const lo  = document.getElementById('dash-label-ofertas');
  const lor = document.getElementById('dash-label-oracoes');
  const lh  = document.getElementById('dash-label-horas');
  const le  = document.getElementById('dash-label-estudos');
  if(lv)  lv.textContent  = `💰 Vendas — ${label}`;
  if(lo)  lo.textContent  = `📦 Ofertas — ${label}`;
  if(lor) lor.textContent = `🙏 Orações — ${label}`;
  if(lh)  lh.textContent  = `⏰ Horas — ${label}`;
  if(le)  le.textContent  = `📖 Estudos — ${label}`;

  document.getElementById('adm-vendas-hoje').textContent       = fmtMini(vData);
  document.getElementById('adm-ofertas-hoje').textContent      = oData;
  document.getElementById('adm-oracoes-hoje').textContent      = orData;
  document.getElementById('adm-horas-hoje').textContent        = fmtHoras(hData);
  document.getElementById('adm-estudos-hoje').textContent      = estData;
  document.getElementById('adm-total-acumulado').textContent   = fmtMini(totalAcum);
  document.getElementById('adm-total-colportores').textContent = liveUsuarios.length;

  // Banner da campanha visualizada (contagem regressiva se for a ativa, ou "finalizada")
  const campVista = getCampanhaPorId(campanhaVisualizada) || CAMPANHA_ATIVA;
  const elBanner = document.getElementById('camp-banner-texto');
  if (elBanner && campVista) {
    if (campVista.ativa) {
      const dr = Math.max(0,Math.ceil((new Date(campVista.dataFim+'T23:59:59')-new Date())/(1000*60*60*24)));
      elBanner.innerHTML = `${escapeHtml(campVista.titulo)} — encerra em <strong style="color:var(--amarelo);font-family:var(--num-font);font-size:16px;">${dr===0?'⛔ Encerrada':dr}</strong> dias — <strong style="color:var(--branco)">${formatarData(campVista.dataFim)}</strong>`;
    } else {
      elBanner.innerHTML = `🏁 ${escapeHtml(campVista.titulo)} — <strong style="color:var(--branco)">Campanha finalizada</strong> (${formatarData(campVista.dataInicio)} a ${formatarData(campVista.dataFim)})`;
    }
  }

  // Meta equipe (da campanha sendo visualizada)
  const metaEq  = campVista?.metaEquipe || 0;
  const pctEq   = metaEq>0?Math.min(100,(totalAcum/metaEq)*100):0;
  const faltaEq = Math.max(0,metaEq-totalAcum);
  const elAlvo  = document.getElementById('meta-eq-alvo');
  if (elAlvo) elAlvo.textContent = fmtMini(metaEq);
  const pctColor= pctEq>=100?'var(--ouro-claro)':pctEq>=75?'#FFC94D':pctEq>=50?'#FFB100':'#8A5200';
  document.getElementById('meta-eq-alcancado').textContent = fmtMini(totalAcum);
  const elF=document.getElementById('meta-eq-falta');
  if(elF){elF.textContent=faltaEq>0?fmtMini(faltaEq):'✅ Meta atingida!';elF.style.color=faltaEq===0?'var(--ouro-claro)':'#FFC94D';}
  const elP=document.getElementById('meta-eq-pct');
  if(elP){elP.textContent=pctEq.toFixed(1)+'%';elP.style.color=pctColor;}
  const elB=document.getElementById('meta-eq-bar');
  if(elB){elB.style.width=pctEq+'%';elB.style.background=`linear-gradient(90deg,${pctColor},rgba(16,26,51,0.3))`;}
  // Render premium chart
  renderDashChart();
  // Render semana maxima widget
  renderSmaxDashWidget();
}

// ── DASHBOARD FILTER BINDINGS ──
function bindDashDatePicker() {
  if (document.getElementById('dash-filtros')?._dashBound) return;
  if (document.getElementById('dash-filtros')) document.getElementById('dash-filtros')._dashBound = true;

  // Quick filter buttons
  document.querySelectorAll('[data-dash-filtro]').forEach(btn=>{
    btn.addEventListener('click', function(){
      document.querySelectorAll('[data-dash-filtro]').forEach(b=>b.classList.remove('dash-f-ativo'));
      this.classList.add('dash-f-ativo');
      dashFiltro = this.getAttribute('data-dash-filtro');

      // Show/hide pickers
      const pd = document.getElementById('dash-picker-data');
      const pp = document.getElementById('dash-picker-periodo');
      if(pd) pd.style.display   = dashFiltro==='data'    ? 'flex' : 'none';
      if(pp) pp.style.display   = dashFiltro==='periodo' ? 'flex' : 'none';

      // For non-picker modes render immediately
      if(dashFiltro!=='data' && dashFiltro!=='periodo') renderAdminDashboard();
    });
  });

  // Single date apply
  const btnApData = document.getElementById('dash-btn-aplicar-data');
  if(btnApData) btnApData.addEventListener('click', ()=>{
    const v = document.getElementById('dash-data-sel')?.value;
    if(!v){ mostrarToast('Selecione uma data.',true); return; }
    dashDataSel = v;
    renderAdminDashboard();
  });

  // Period apply
  const btnApPer = document.getElementById('dash-btn-aplicar-periodo');
  if(btnApPer) btnApPer.addEventListener('click', ()=>{
    const ini = document.getElementById('dash-periodo-ini')?.value;
    const fim = document.getElementById('dash-periodo-fim')?.value;
    if(!ini||!fim||ini>fim){ mostrarToast('Período inválido.',true); return; }
    dashPeriodoIni = ini; dashPeriodoFim = fim;
    renderAdminDashboard();
  });

  // Set default date values
  const ds = document.getElementById('dash-data-sel');
  const pi = document.getElementById('dash-periodo-ini');
  const pf = document.getElementById('dash-periodo-fim');
  if(ds && !ds.value) ds.value = getHoje();
  if(pi && !pi.value) pi.value = getHoje();
  if(pf && !pf.value) pf.value = getHoje();
}


// ── GRÁFICO PREMIUM DO DASHBOARD ──
function renderDashChart() {
  const regs = getDashRegs();
  const label = getDashLabel();

  // Update period label
  const lbl = document.getElementById('dash-chart-periodo-label');
  if(lbl) lbl.textContent = `Período: ${label}`;

  // Build days map: date → { vista, prazo }
  const dayMap = {};
  regs.forEach(r => {
    if (!dayMap[r.data]) dayMap[r.data] = { vista: 0, prazo: 0 };
    dayMap[r.data].vista += r.vista  || 0;
    dayMap[r.data].prazo += r.prazo  || 0;
  });

  // For 'hoje' or 'data' (single day), show per-colportor breakdown instead of day-by-day
  let datas, vistaArr, prazoArr, xLabels;
  const isSingleDay = (dashFiltro === 'hoje' || dashFiltro === 'data');

  if (isSingleDay) {
    // Show per-colportor bars for that day
    const dataAlvo = (dashFiltro === 'data' && dashDataSel) ? dashDataSel : getHoje();
    const regsDay  = liveRegistros.filter(r => r.data === dataAlvo);
    const userMap  = {};
    regsDay.forEach(r => {
      const u = liveUsuarios.find(x => x.id === r.userId);
      const nome = u ? u.nome.split(' ')[0] : 'Desconhecido';
      if (!userMap[nome]) userMap[nome] = { vista: 0, prazo: 0 };
      userMap[nome].vista += r.vista || 0;
      userMap[nome].prazo += r.prazo || 0;
    });
    const sorted = Object.entries(userMap).sort((a,b)=>b[1].vista-a[1].vista);
    xLabels  = sorted.map(x=>x[0]);
    vistaArr = sorted.map(x=>x[1].vista);
    prazoArr = sorted.map(x=>x[1].prazo);
    datas    = null;
  } else {
    datas    = Object.keys(dayMap).sort();
    xLabels  = datas.map(d => formatarData(d).slice(0,5)); // dd/mm
    vistaArr = datas.map(d => dayMap[d].vista);
    prazoArr = datas.map(d => dayMap[d].prazo);
  }

  // Metrics
  const totalVista = vistaArr.reduce((s,v)=>s+v, 0);
  const totalPrazo = prazoArr.reduce((s,v)=>s+v, 0);
  const diasAtivos = vistaArr.filter(v=>v>0).length;
  const media      = diasAtivos > 0 ? totalVista / diasAtivos : 0;
  const maxVista   = Math.max(...vistaArr, 0);
  const maxIdx     = vistaArr.indexOf(maxVista);
  const melhorLabel= maxIdx >= 0 && xLabels[maxIdx] ? xLabels[maxIdx] : '—';

  const elMelhor = document.getElementById('dash-metric-melhor');
  const elMedia  = document.getElementById('dash-metric-media');
  const elVista  = document.getElementById('dash-metric-vista');
  const elPrazo  = document.getElementById('dash-metric-prazo');
  const elDias   = document.getElementById('dash-metric-dias');
  if(elMelhor) elMelhor.textContent = melhorLabel;
  if(elMedia)  elMedia.textContent  = fmtMini(media);
  if(elVista)  elVista.textContent  = fmtMini(totalVista);
  if(elPrazo)  elPrazo.textContent  = fmtMini(totalPrazo);
  if(elDias)   elDias.textContent   = diasAtivos + (isSingleDay ? ' colport.' : ' dias');

  // Destroy old chart
  destroyChart('dash-chart-principal');
  const ctx = document.getElementById('dash-chart-principal');
  if (!ctx) return;

  // Build gradient fills
  const ctxC = ctx.getContext('2d');
  const gradVista = ctxC.createLinearGradient(0, 0, 0, 240);
  gradVista.addColorStop(0,   'rgba(255,177,0,0.35)');
  gradVista.addColorStop(0.5, 'rgba(255,177,0,0.10)');
  gradVista.addColorStop(1,   'rgba(255,177,0,0.00)');

  const gradPrazo = ctxC.createLinearGradient(0, 0, 0, 240);
  gradPrazo.addColorStop(0,   'rgba(25,118,210,0.30)');
  gradPrazo.addColorStop(0.5, 'rgba(25,118,210,0.08)');
  gradPrazo.addColorStop(1,   'rgba(25,118,210,0.00)');

  // Point colors: gold for max, white otherwise
  const pointBgVista = vistaArr.map((v,i) => v === maxVista && v > 0 ? '#EF5350' : '#FFB100');
  const pointRadii   = vistaArr.map((v,i) => v === maxVista && v > 0 ? 7 : 4);

  const isBar = isSingleDay;
  const type  = isBar ? 'bar' : 'line';

  const datasets = [
    {
      label: 'À Vista',
      data:  vistaArr,
      ...(isBar ? {
        backgroundColor: vistaArr.map((v,i) => v===maxVista && v>0
          ? 'rgba(239,83,80,0.85)'
          : 'rgba(255,177,0,0.70)'),
        borderColor: vistaArr.map((v,i) => v===maxVista && v>0 ? '#EF5350' : '#FFB100'),
        borderWidth: 2,
        borderRadius: 6,
        borderSkipped: false,
      } : {
        borderColor: '#FFB100',
        backgroundColor: gradVista,
        borderWidth: 2.5,
        fill: true,
        tension: 0.45,
        pointBackgroundColor: pointBgVista,
        pointBorderColor: '#fff',
        pointBorderWidth: 1.5,
        pointRadius: pointRadii,
        pointHoverRadius: 8,
      }),
      order: 1,
    },
    {
      label: 'No Pedido',
      data:  prazoArr,
      ...(isBar ? {
        backgroundColor: 'rgba(25,118,210,0.55)',
        borderColor: '#1976D2',
        borderWidth: 2,
        borderRadius: 6,
        borderSkipped: false,
      } : {
        borderColor: '#1976D2',
        backgroundColor: gradPrazo,
        borderWidth: 2,
        fill: true,
        tension: 0.45,
        pointBackgroundColor: '#1976D2',
        pointBorderColor: '#fff',
        pointBorderWidth: 1.5,
        pointRadius: 4,
        pointHoverRadius: 7,
        borderDash: [],
      }),
      order: 2,
    },
  ];

  // Best day annotation line (only for multi-day line chart)
  if (!isBar && maxVista > 0) {
    datasets.push({
      label: 'Melhor Dia',
      data: vistaArr.map(() => maxVista),
      borderColor: 'rgba(239,83,80,0.45)',
      borderWidth: 1.5,
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false,
      tension: 0,
      order: 3,
    });
  }

  chartInstances['dash-chart-principal'] = new Chart(ctx, {
    type,
    data: { labels: xLabels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700, easing: 'easeInOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10,15,28,0.96)',
          borderColor: 'rgba(255,177,0,0.35)',
          borderWidth: 1,
          titleColor: '#FFCE45',
          bodyColor: '#C4CADE',
          padding: 12,
          cornerRadius: 10,
          titleFont: { size: 12, weight: '700' },
          bodyFont: { size: 12 },
          callbacks: {
            title: (items) => isSingleDay
              ? `👤 ${items[0].label}`
              : `📅 ${xLabels[items[0].dataIndex] || ''}`,
            label: (item) => {
              if (item.dataset.label === 'Melhor Dia') return null;
              const v = item.raw || 0;
              const icon = item.dataset.label === 'À Vista' ? '💰' : '📅';
              return ` ${icon} ${item.dataset.label}: ${fmtMini(v)}`;
            },
            afterBody: (items) => {
              const idx = items[0].dataIndex;
              const v = vistaArr[idx] || 0;
              const p = prazoArr[idx] || 0;
              if (v + p === 0) return [];
              return [``, ` 🔢 Total: ${fmtMini(v + p)}`];
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: '#8891AC',
            font: { size: 10, weight: '600' },
            maxRotation: 35,
          },
          grid: { color: 'rgba(255,177,0,0.05)' },
          border: { color: 'rgba(255,177,0,0.12)' },
        },
        y: {
          ticks: {
            color: '#8891AC',
            font: { size: 10 },
            callback: v => v >= 1000 ? `R$${(v/1000).toFixed(0)}k` : `R$${v}`,
          },
          grid: { color: 'rgba(255,177,0,0.06)', drawTicks: false },
          border: { color: 'rgba(255,177,0,0.12)', dash: [4, 4] },
          beginAtZero: true,
        },
      },
    },
  });
}

// ── RANKING ──
const top3Config = [
  { tClass:'t1', icon:'🥇', label:'1º Lugar' },
  { tClass:'t2', icon:'🥈', label:'2º Lugar' },
  { tClass:'t3', icon:'🥉', label:'3º Lugar' },
];

function renderRanking() {
  const usuarios = liveUsuarios.map(u=>({...u,
    totalVendas:  getRegsUser(u.id).reduce((s,r)=>s+(r.vista||0),0),
    totalOfertas: getRegsUser(u.id).reduce((s,r)=>s+(r.ofertas||0),0),
    totalOracoes: getRegsUser(u.id).reduce((s,r)=>s+(r.oracoes||0),0),
    totalHoras:   getRegsUser(u.id).reduce((s,r)=>s+(r.horas||0),0),
  }));
  const campo = {vendas:'totalVendas',ofertas:'totalOfertas',oracoes:'totalOracoes',horas:'totalHoras'}[rankOrdem];
  usuarios.sort((a,b)=>b[campo]-a[campo]);
  const fmt = {vendas:fmtMini,ofertas:v=>v,oracoes:v=>v,horas:fmtHoras}[rankOrdem];

  if (!usuarios.length) {
    document.getElementById('ranking-list').innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><div>Nenhum colportor.</div></div>';
    return;
  }

  // ── TOP 3 CARDS ──
  const valLabel = {vendas:'vendas à vista',ofertas:'ofertas',oracoes:'orações',horas:'horas trabalhadas'}[rankOrdem];

  const top3HTML = '<div class="top3-wrap">' +
    usuarios.slice(0,3).map((u, i) => {
      const cfg = top3Config[i];
      const val = fmt(u[campo]);
      const pct = u.meta>0 ? (u.totalVendas/u.meta*100).toFixed(1) : null;
      const metaInfo = rankOrdem==='vendas' && pct!==null
        ? `${pct}% da meta · ${u.tel||'—'}`
        : `📞 ${u.tel||'—'}`;
      return `
        <div class="top3-card ${cfg.tClass}">
          <div class="top3-stripe"></div>
          <div class="top3-glow"></div>
          <div class="top3-badge">${cfg.icon}</div>
          <div class="top3-avatar">${iniciais(u.nome)}</div>
          <div class="top3-info">
            <div class="top3-nome">${escapeHtml(u.nome)}</div>
            <div class="top3-sub">${cfg.label} · ${metaInfo}</div>
          </div>
          <div class="top3-val">
            <div class="top3-val-num">${val}</div>
            <div class="top3-val-label">${valLabel}</div>
          </div>
        </div>`;
    }).join('') + '</div>';

  // ── LISTA: 4º em diante ──
  const restHTML = usuarios.length > 3
    ? '<div class="top3-divider"></div><div class="top3-wrap">' +
        usuarios.slice(3).map((u,i) => {
          const pos = i + 4;
          const val = fmt(u[campo]);
          const pct = rankOrdem==='vendas' && u.meta>0 ? (u.totalVendas/u.meta*100).toFixed(1)+'% da meta · ' : '';
          return `
          <div class="top3-card tn">
            <div class="top3-stripe"></div>
            <div class="top3-glow"></div>
            <div class="top3-badge">${pos}º</div>
            <div class="top3-avatar">${iniciais(u.nome)}</div>
            <div class="top3-info">
              <div class="top3-nome">${escapeHtml(u.nome)}</div>
              <div class="top3-sub">${pct}📞 ${escapeHtml(u.tel)||'—'}</div>
            </div>
            <div class="top3-val">
              <div class="top3-val-num">${val}</div>
              <div class="top3-val-label">${valLabel}</div>
            </div>
          </div>`;
        }).join('') + '</div>'
    : '';

  document.getElementById('ranking-list').innerHTML = top3HTML + restHTML;
}

// ── RANKING: BOLSA DE ESTUDOS (TOP 10 mais próximos da meta) ──
function renderRankingBolsa() {
  const cont = document.getElementById('ranking-bolsa-list');
  if (!cont) return;

  const usuarios = liveUsuarios
    .filter(u => u.meta > 0) // só entram no ranking colportores com meta cadastrada
    .map(u => {
      const totalVendas = getRegsUser(u.id).reduce((s,r)=>s+(r.vista||0),0);
      const pct = totalVendas / u.meta * 100;
      return {...u, totalVendas, pct};
    })
    .sort((a,b)=>b.pct-a.pct)
    .slice(0,10);

  if (!usuarios.length) {
    cont.innerHTML = '<div class="empty-state"><div class="empty-icon">🎯</div><div>Nenhum colportor com meta cadastrada.</div></div>';
    return;
  }

  const top3HTML = '<div class="top3-wrap">' +
    usuarios.slice(0,3).map((u, i) => {
      const cfg = top3Config[i];
      const pct = u.pct.toFixed(1);
      return `
        <div class="top3-card ${cfg.tClass}">
          <div class="top3-stripe"></div>
          <div class="top3-glow"></div>
          <div class="top3-badge">${cfg.icon}</div>
          <div class="top3-avatar">${iniciais(u.nome)}</div>
          <div class="top3-info">
            <div class="top3-nome">${escapeHtml(u.nome)}</div>
            <div class="top3-sub">${cfg.label} · ${fmtMini(u.totalVendas)} de ${fmtMini(u.meta)}</div>
          </div>
          <div class="top3-val">
            <div class="top3-val-num">${pct}%</div>
            <div class="top3-val-label">da meta</div>
          </div>
        </div>`;
    }).join('') + '</div>';

  const restHTML = usuarios.length > 3
    ? '<div class="top3-divider"></div><div class="top3-wrap">' +
        usuarios.slice(3).map((u,i) => {
          const pos = i + 4;
          const pct = u.pct.toFixed(1);
          return `
          <div class="top3-card tn">
            <div class="top3-stripe"></div>
            <div class="top3-glow"></div>
            <div class="top3-badge">${pos}º</div>
            <div class="top3-avatar">${iniciais(u.nome)}</div>
            <div class="top3-info">
              <div class="top3-nome">${escapeHtml(u.nome)}</div>
              <div class="top3-sub">${fmtMini(u.totalVendas)} de ${fmtMini(u.meta)}</div>
            </div>
            <div class="top3-val">
              <div class="top3-val-num">${pct}%</div>
              <div class="top3-val-label">da meta</div>
            </div>
          </div>`;
        }).join('') + '</div>'
    : '';

  cont.innerHTML = top3HTML + restHTML;
}
document.querySelectorAll('[data-rank]').forEach(btn=>btn.addEventListener('click',function(){
  document.querySelectorAll('[data-rank]').forEach(b=>b.classList.remove('active'));
  this.classList.add('active');
  rankOrdem = this.getAttribute('data-rank');
  renderRanking();
}));

// ── TABELA EQUIPE ──
// ── Filtro de período no perfil ──
let perfilFiltro  = 'campanha';
let perfilDataIni = '2026-06-01';
let perfilDataFim = '';

function filtrarRegsPorPeriodo(regs, periodo) {
  const hoje = new Date();
  hoje.setHours(23,59,59,999);
  if (periodo === 'campanha') return regs;
  if (periodo === 'semana') {
    const ini = new Date(hoje); ini.setDate(hoje.getDate() - 6); ini.setHours(0,0,0,0);
    return regs.filter(r => new Date(r.data+'T12:00:00') >= ini);
  }
  if (periodo === '15dias') {
    const ini = new Date(hoje); ini.setDate(hoje.getDate() - 14); ini.setHours(0,0,0,0);
    return regs.filter(r => new Date(r.data+'T12:00:00') >= ini);
  }
  if (periodo === 'mes') {
    const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    return regs.filter(r => new Date(r.data+'T12:00:00') >= ini);
  }
  if (periodo === 'datas') {
    const ini = new Date((perfilDataIni||AGENDA_INICIO)+'T00:00:00');
    const fim = new Date((perfilDataFim||getHoje())+'T23:59:59');
    return regs.filter(r => {
      const d = new Date(r.data+'T12:00:00');
      return d >= ini && d <= fim;
    });
  }
  return regs;
}

function nomePeriodo(p) {
  return {campanha:'Campanha inteira',semana:'Esta semana',mes:'Este mês','15dias':'Últimos 15 dias'}[p]||p;
}

let tabelaPeriodo = 'campanha';

function renderTabelaEquipe() {
  const busca = (document.getElementById('filtro-busca').value||'').toLowerCase();
  const lista = liveUsuarios.filter(u=>!busca||u.nome.toLowerCase().includes(busca)).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
  const tbody = document.getElementById('tabela-equipe-body');
  const labelEl = document.getElementById('equipe-periodo-label');
  if (labelEl) labelEl.textContent = tabelaPeriodo === 'campanha' ? '' : `Mostrando: ${nomePeriodo(tabelaPeriodo)}`;

  // Devolução total da equipe (soma de todos os colportores, sempre visão geral)
  const devTotalEquipe = liveUsuarios.reduce((s,u)=>s+getDevolucaoTotal(u.id),0);
  const devTotalEl = document.getElementById('equipe-devolucao-total');
  if (devTotalEl) devTotalEl.textContent = fmtMoeda(devTotalEquipe);

  if (!lista.length) { tbody.innerHTML='<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--texto3)">Nenhum colportor encontrado.</td></tr>'; return; }
  tbody.innerHTML = lista.map(u=>{
    const regsP = filtrarRegsPorPeriodo(getRegsUser(u.id), tabelaPeriodo);
    const vistaTotal = getVistaUser(u.id); // always full for meta %
    const vista = regsP.reduce((s,r)=>s+(r.vista||0),0);
    const prazo = regsP.reduce((s,r)=>s+(r.prazo||0),0);
    const falta = Math.max(0,u.meta-vistaTotal), pct=u.meta>0?(vistaTotal/u.meta*100).toFixed(1):0;
    const pctN=parseFloat(pct);
    const devU = getDevolucaoTotal(u.id);
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:8px;"><div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,var(--verde),var(--azul));display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#000;flex-shrink:0;">${escapeHtml(iniciais(u.nome))}</div><span style="font-weight:700">${escapeHtml(u.nome)}</span></div></td>
      <td style="font-family:var(--num-font);font-size:12px">${escapeHtml(u.tel)||'—'}</td>
      <td class="color-blue">${fmtMini(u.meta)}</td>
      <td class="color-green">${fmtMini(vista)}</td>
      <td style="color:var(--azul-claro);font-family:var(--num-font)">${fmtMini(prazo)}</td>
      <td style="color:var(--amarelo);font-family:var(--num-font)">${fmtMini(falta)}</td>
      <td><div style="display:flex;align-items:center;gap:8px;"><div style="flex:1;background:rgba(16,26,51,0.08);border-radius:100px;height:8px;min-width:60px;"><div style="height:100%;border-radius:100px;width:${Math.min(100,pctN)}%;background:${pctN>=100?'var(--ouro)':pctN>=50?'#CC8C00':'#FFC94D'};"></div></div><span style="font-family:var(--num-font);font-size:12px;font-weight:700;color:${pctN>=100?'var(--ouro-claro)':pctN>=50?'#3D5DF2':'#FFC94D'}">${pct}%</span></div></td>
      <td style="color:#FF8A65;font-family:var(--num-font);font-weight:700">${devU>0?fmtMini(devU):'—'}</td>
      <td><span class="senha-mascarada" data-senha="${escapeHtml(u.senha)}" style="font-family:var(--num-font);color:var(--texto3);background:rgba(16,26,51,0.05);padding:3px 8px;border-radius:6px;letter-spacing:3px;cursor:pointer;" title="Clique para mostrar/ocultar">••••</span></td>
      <td><div class="admin-actions"><button data-ver="${u.id}" style="padding:6px 10px;border-radius:7px;border:1px solid rgba(255,177,0,0.3);background:rgba(255,177,0,0.08);color:var(--ouro-claro);font-size:11px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;">👤 Ver</button><button data-remover="${u.id}" style="padding:6px 10px;border-radius:7px;border:1px solid rgba(239,83,80,0.3);background:rgba(239,83,80,0.08);color:#EF9090;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;">🗑️</button></div></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-ver]').forEach(b=>b.addEventListener('click',function(){ abrirPerfil(this.getAttribute('data-ver')); }));
  tbody.querySelectorAll('[data-remover]').forEach(b=>b.addEventListener('click',function(){
    const uid=this.getAttribute('data-remover');
    const u=liveUsuarios.find(x=>x.id===uid);
    if(!u) return;
    mostrarConfirm(`Remover "${u.nome}"?`,'Todos os registros serão apagados.',async()=>{
      // Delete user and all their records
      await deleteDoc(doc(db,'usuarios',uid));
      const batch = writeBatch(db);
      liveRegistros.filter(r=>r.userId===uid).forEach(r=>batch.delete(doc(db,'registros',r.id)));
      const devU = liveDevolucoes.find(d=>d.id===uid);
      if (devU) batch.delete(doc(db,'devolucoes',uid));
      liveEstudos.filter(e=>e.colportorId===uid).forEach(e=>batch.delete(doc(db,'estudosBiblicos',e.id)));
      await batch.commit();
      mostrarToast('Colportor removido.');
    });
  }));
}
document.getElementById('filtro-busca').addEventListener('input', renderTabelaEquipe);
// Period filter buttons in equipe tab
document.querySelectorAll('[data-tperiodo]').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('[data-tperiodo]').forEach(b=>{ b.classList.remove('active'); b.style.background='transparent'; b.style.borderColor='rgba(255,177,0,0.15)'; b.style.color='var(--texto3)'; });
    this.classList.add('active'); this.style.background='linear-gradient(135deg,#FFB100,#B45309)'; this.style.borderColor='var(--ouro)'; this.style.color='#000';
    tabelaPeriodo = this.getAttribute('data-tperiodo');
    renderTabelaEquipe();
  });
});

// ── PERFIL MODAL ──
function abrirPerfil(uid) {
  modalColportorId = uid;
  perfilFiltro  = 'campanha';
  perfilDataIni = AGENDA_INICIO;
  perfilDataFim = getHoje();
  renderPerfilConteudo(uid);
  document.getElementById('perfil-modal').classList.add('open');
}

document.getElementById('btn-ver-lista-dev-modal').addEventListener('click', function(){
  const cont = document.getElementById('modal-lista-dev-detalhe');
  const abrindo = cont.style.display === 'none';
  if (abrindo) {
    const salvo = getDevolucaoUser(modalColportorId);
    cont.innerHTML = montarListaDevolucaoHTML(salvo ? salvo.itens : [], '#FF8A65');
    cont.style.display = 'block';
    this.textContent = '🔼 Ocultar';
  } else {
    cont.style.display = 'none';
    this.textContent = '👁️ Ver lista';
  }
});

function renderPerfilConteudo(uid) {
  const u = liveUsuarios.find(x=>x.id===uid);
  if (!u) return;

  const todosRegs = getRegsUser(uid);
  const regs      = filtrarRegsPorPeriodo(todosRegs, perfilFiltro);

  // Totais do período selecionado
  const vista  = regs.reduce((s,r)=>s+(r.vista||0),0);
  const prazo  = regs.reduce((s,r)=>s+(r.prazo||0),0);
  const medPeriodo = calcMediasDiarias(regs);
  // Totais da campanha completa (para meta/pizza)
  const vistaTotal = todosRegs.reduce((s,r)=>s+(r.vista||0),0);
  const falta  = Math.max(0, u.meta - vistaTotal);
  const pct    = u.meta>0 ? Math.min(100,(vistaTotal/u.meta)*100) : 0;

  // Avatar
  const av = document.getElementById('modal-avatar');
  av.textContent = iniciais(u.nome);

  document.getElementById('modal-nome').textContent = u.nome;
  document.getElementById('modal-dados').innerHTML =
    `📞 ${u.tel||'—'}<br>📅 Total de dias: ${contarDiasTrabalhados(todosRegs)} · 📅 No período: ${contarDiasTrabalhados(regs)}`;

  // Bolsa (sempre campanha completa)
  document.getElementById('modal-meta').textContent       = fmtMoeda(u.meta);
  document.getElementById('modal-vendido').textContent    = fmtMoeda(vistaTotal);
  document.getElementById('modal-falta').textContent      = fmtMoeda(falta);
  document.getElementById('modal-pct').textContent        = pct.toFixed(1)+'%';
  document.getElementById('modal-prazo-info').textContent = fmtMoeda(todosRegs.reduce((s,r)=>s+(r.prazo||0),0));
  const devUModal = getDevolucaoUser(uid);
  document.getElementById('modal-devolucao-info').textContent = devUModal && devUModal.total>0
    ? fmtMoeda(devUModal.total) + (devUModal.atualizadoEm ? ` (atualizado em ${formatarData(devUModal.atualizadoEm)})` : '')
    : 'R$ 0,00';
  const listaDevModal = document.getElementById('modal-lista-dev-detalhe');
  const btnListaDevModal = document.getElementById('btn-ver-lista-dev-modal');
  if (listaDevModal) { listaDevModal.style.display = 'none'; listaDevModal.innerHTML = ''; }
  if (btnListaDevModal) btnListaDevModal.textContent = '👁️ Ver lista';

  // Pizza (campanha completa)
  setTimeout(()=>{
    destroyChart('modal-pizza');
    const ctx=document.getElementById('modal-pizza');
    if(ctx&&typeof Chart!=='undefined'){
      const c=pct>=100?'#FFB100':pct>=75?'#FFC94D':pct>=50?'#CC8C00':pct>=25?'#B45309':'#EF5350';
      chartInstances['modal-pizza']=new Chart(ctx,{type:'doughnut',data:{datasets:[{data:[vistaTotal,Math.max(0,u.meta-vistaTotal)],backgroundColor:[c,'rgba(16,26,51,0.06)'],borderColor:['transparent','transparent'],borderWidth:0}]},options:{responsive:false,cutout:'72%',plugins:{legend:{display:false},tooltip:{enabled:false}},animation:{duration:600}}});
    }
  },50);

  // ── FILTROS DE PERÍODO + DATAS ──
  const dataIniVal = perfilDataIni || AGENDA_INICIO;
  const dataFimVal = perfilDataFim || getHoje();
  const filtrosHTML = `
    <div style="background:rgba(255,177,0,0.05);border:1px solid rgba(255,177,0,0.2);border-radius:12px;padding:14px 16px;margin-bottom:16px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--texto3);font-weight:700;margin-bottom:10px;">📊 Filtrar período</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;" id="perfil-filtros">
        ${['campanha','semana','15dias','mes','datas'].map(p=>`
          <button data-pfiltro="${p}" style="padding:6px 12px;border-radius:100px;border:1px solid ${perfilFiltro===p?'var(--ouro)':'rgba(255,177,0,0.12)'};background:${perfilFiltro===p?'linear-gradient(135deg,#FFB100,#B45309)':'transparent'};color:${perfilFiltro===p?'#000':'var(--texto3)'};font-family:Inter,sans-serif;font-size:11px;font-weight:700;cursor:pointer;transition:all 0.15s;">
            ${p==='campanha'?'📅 Completo':p==='semana'?'7 dias':p==='15dias'?'15 dias':p==='mes'?'Este mês':'📆 Personalizado'}
          </button>`).join('')}
      </div>
      <div id="perfil-datas-custom" style="display:${perfilFiltro==='datas'?'flex':'none'};gap:10px;flex-wrap:wrap;align-items:center;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:11px;color:var(--texto3);font-weight:600;">De:</span>
          <input type="date" id="perfil-data-ini" value="${dataIniVal}" min="${AGENDA_INICIO}" max="${DATA_ENCERRAMENTO}"
            style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,177,0,0.3);background:rgba(16,26,51,0.04);color:var(--branco);font-family:'Inter',sans-serif;font-size:12px;outline:none;">
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:11px;color:var(--texto3);font-weight:600;">Até:</span>
          <input type="date" id="perfil-data-fim" value="${dataFimVal}" min="${AGENDA_INICIO}" max="${DATA_ENCERRAMENTO}"
            style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,177,0,0.3);background:rgba(16,26,51,0.04);color:var(--branco);font-family:'Inter',sans-serif;font-size:12px;outline:none;">
        </div>
        <button id="perfil-btn-filtrar" style="padding:6px 14px;border-radius:8px;border:none;background:linear-gradient(135deg,#FFB100,#B45309);color:#000;font-family:'Inter',sans-serif;font-size:12px;font-weight:700;cursor:pointer;">Filtrar</button>
      </div>
    </div>`;

  // ── LABEL DO PERÍODO ──
  const labelPeriodo = perfilFiltro==='datas'
    ? `${formatarData(dataIniVal)} a ${formatarData(dataFimVal)}`
    : (perfilFiltro==='campanha'?'Campanha completa':perfilFiltro==='semana'?'Últimos 7 dias':perfilFiltro==='15dias'?'Últimos 15 dias':'Este mês');

  // ── STATS DO PERÍODO ──
  const statsHTML = `
    <div style="background:rgba(255,177,0,0.05);border:1px solid rgba(255,177,0,0.15);border-radius:14px;padding:16px;margin-bottom:16px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--ouro-claro);font-weight:700;margin-bottom:12px;">
        📈 ${labelPeriodo} — Resultados
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;">
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--ouro);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">💰 À Vista</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:var(--ouro-claro);">${fmtMini(vista)}</div>
        </div>
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--azul-medio);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">📋 No Pedido</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:var(--azul-claro);">${fmtMini(prazo)}</div>
        </div>
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--azul-medio);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">📦 Ofertas</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:var(--azul-claro);">${regs.reduce((s,r)=>s+(r.ofertas||0),0)}</div>
        </div>
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--amarelo);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">🙏 Orações</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:var(--amarelo);">${regs.reduce((s,r)=>s+(r.oracoes||0),0)}</div>
        </div>
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--laranja);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">⏰ Horas</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:#FFAB40;">${fmtHoras(regs.reduce((s,r)=>s+(r.horas||0),0))}</div>
        </div>
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--ouro);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">📅 Dias</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:var(--ouro-claro);">${contarDiasTrabalhados(regs)}</div>
        </div>
      </div>
    </div>
    <div style="background:rgba(255,177,0,0.05);border:1px solid rgba(255,177,0,0.15);border-radius:14px;padding:16px;margin-bottom:16px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--ouro-claro);font-weight:700;margin-bottom:12px;">
        📊 Médias Diárias — ${labelPeriodo} <span style="color:var(--texto3);font-weight:500;text-transform:none;letter-spacing:0;">(por dia registrado)</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;">
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--ouro);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">💰 Média Vendas/dia</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:var(--ouro-claro);">${fmtMini(medPeriodo.mediaVendas)}</div>
        </div>
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--azul-medio);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">📦 Média Ofertas/dia</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:var(--azul-claro);">${medPeriodo.mediaOfertas.toFixed(1)}</div>
        </div>
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--laranja);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">⏰ Média Horas/dia</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:#FFAB40;">${fmtHoras(medPeriodo.mediaHoras)}</div>
        </div>
        <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--ouro);">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">📅 Dias Trabalhados</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:var(--ouro-claro);">${medPeriodo.dias}</div>
        </div>
      </div>
    </div>`;

  document.getElementById('modal-stats').innerHTML = filtrosHTML + statsHTML;

  // Bind filtro buttons
  document.querySelectorAll('[data-pfiltro]').forEach(btn => {
    btn.addEventListener('click', function() {
      perfilFiltro = this.getAttribute('data-pfiltro');
      const customArea = document.getElementById('perfil-datas-custom');
      if (customArea) customArea.style.display = perfilFiltro==='datas'?'flex':'none';
      if (perfilFiltro !== 'datas') renderPerfilConteudo(modalColportorId);
    });
  });
  // Bind custom date filter button
  const btnFiltrar = document.getElementById('perfil-btn-filtrar');
  if (btnFiltrar) {
    btnFiltrar.addEventListener('click', ()=>{
      const ini = document.getElementById('perfil-data-ini')?.value;
      const fim = document.getElementById('perfil-data-fim')?.value;
      if (ini && fim && ini <= fim) {
        perfilDataIni = ini;
        perfilDataFim = fim;
        renderPerfilConteudo(modalColportorId);
      } else {
        mostrarToast('⚠️ Datas inválidas. "De" deve ser menor que "Até".', true);
      }
    });
  }

  // ── TABELA DE REGISTROS (do período filtrado) ──
  const regsRev = [...regs].reverse().slice(0,50);
  document.getElementById('modal-registros').innerHTML = regsRev.length === 0
    ? `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--texto3);">Nenhum registro neste período.</td></tr>`
    : regsRev.map((r,i)=>`
    <tr id="mrow-${i}" ${r.justificado?'style="background:rgba(180,83,9,0.08);"':''}>
      <td><input type="date" data-id="${r.id}" data-campo="data" value="${r.data}" style="background:rgba(16,26,51,0.06);border:1px solid rgba(16,26,51,0.12);border-radius:6px;padding:4px 6px;color:var(--branco);font-family:var(--body-font);font-size:11px;width:120px;outline:none;"><div style="font-size:10px;color:var(--texto3);margin-top:3px;">${getDiaSemana(r.data)}</div>${r.justificado?`<div style="margin-top:5px;"><span style="display:inline-block;background:rgba(180,83,9,0.18);border:1px solid rgba(180,83,9,0.35);border-radius:100px;padding:2px 8px;font-size:9px;font-weight:700;color:#FFB100;text-transform:uppercase;letter-spacing:0.5px;">📢 Justificado</span></div>`:''}</td>
      <td><input type="number" data-id="${r.id}" data-campo="ofertas" value="${r.ofertas||0}" style="width:58px;background:rgba(16,26,51,0.06);border:1px solid rgba(16,26,51,0.12);border-radius:6px;padding:5px 7px;color:var(--texto);font-family:var(--num-font);font-size:12px;"></td>
      <td><input type="text" data-id="${r.id}" data-campo="vista" data-money="1" data-raw="${r.vista||0}" value="${floatParaMoeda(r.vista||0)}" style="width:88px;background:rgba(255,177,0,0.05);border:1px solid rgba(255,177,0,0.15);border-radius:6px;padding:5px 7px;color:var(--verde-claro);font-family:var(--num-font);font-size:12px;" inputmode="decimal"></td>
      <td><input type="text" data-id="${r.id}" data-campo="prazo" data-money="1" data-raw="${r.prazo||0}" value="${floatParaMoeda(r.prazo||0)}" style="width:88px;background:rgba(21,101,192,0.06);border:1px solid rgba(21,101,192,0.2);border-radius:6px;padding:5px 7px;color:var(--azul-claro);font-family:var(--num-font);font-size:12px;" inputmode="decimal"></td>
      <td><input type="number" data-id="${r.id}" data-campo="oracoes" value="${r.oracoes||0}" style="width:58px;background:rgba(16,26,51,0.06);border:1px solid rgba(16,26,51,0.12);border-radius:6px;padding:5px 7px;color:var(--texto);font-family:var(--num-font);font-size:12px;"></td>
      <td><input type="number" data-id="${r.id}" data-campo="horas"   value="${r.horas||0}"   style="width:58px;background:rgba(16,26,51,0.06);border:1px solid rgba(16,26,51,0.12);border-radius:6px;padding:5px 7px;color:var(--texto);font-family:var(--num-font);font-size:12px;"></td>
      <td>
        <button data-save="${i}" style="padding:5px 8px;border-radius:6px;border:1px solid rgba(255,177,0,0.3);background:rgba(255,177,0,0.08);color:var(--ouro-claro);font-size:10px;cursor:pointer;margin-bottom:3px;font-family:Inter,sans-serif;font-weight:700;">💾</button>
        <button data-delreg="${r.id}" style="padding:5px 8px;border-radius:6px;border:1px solid rgba(239,83,80,0.3);background:rgba(239,83,80,0.08);color:#EF9090;font-size:10px;cursor:pointer;font-family:Inter,sans-serif;font-weight:700;">🗑️</button>
      </td>
    </tr>${r.justificado?`
    <tr ${r.justificado?'style="background:rgba(180,83,9,0.04);"':''}>
      <td colspan="6" style="padding:4px 12px 10px 12px;font-size:11px;color:var(--texto2);font-style:italic;border-top:none;">📢 Motivo: ${escapeHtml(r.motivoJustificativa)||'—'}</td>
      <td></td>
    </tr>`:''}`).join('');

  // Bind money masks on inline inputs
  bindMascarasInline(document.getElementById('modal-registros').closest('table') || document.getElementById('modal-registros').parentElement);
  // Bind save
  document.querySelectorAll('[data-save]').forEach(btn=>btn.addEventListener('click',async function(){
    const i=this.getAttribute('data-save');
    const row=document.getElementById('mrow-'+i);
    const upd={};
    row.querySelectorAll('[data-id]').forEach(inp=>{ const campo=inp.getAttribute('data-campo'); if(campo==='data'){upd[campo]=inp.value;}else if(inp.getAttribute('data-money')){upd[campo]=moedaParaFloat(inp.value);}else{upd[campo]=parseFloat(inp.value)||0;} });
    const rid=row.querySelector('[data-id]').getAttribute('data-id');
    showSyncStatus('💾 Salvando...','saving');
    await updateDoc(doc(db,'registros',rid),upd);
    showSyncStatus('✅ Salvo!','saved');
    mostrarToast('✅ Registro salvo!');
  }));
  // Bind delete
  document.querySelectorAll('[data-delreg]').forEach(btn=>btn.addEventListener('click',function(){
    const rid=this.getAttribute('data-delreg');
    mostrarConfirm('Apagar este registro?','',async()=>{
      await deleteDoc(doc(db,'registros',rid));
      mostrarToast('Registro apagado.');
      renderPerfilConteudo(modalColportorId);
    });
  }));
}
document.getElementById('btn-fechar-perfil').addEventListener('click',()=>document.getElementById('perfil-modal').classList.remove('open'));
document.getElementById('perfil-modal').addEventListener('click',e=>{ if(e.target===document.getElementById('perfil-modal')) document.getElementById('perfil-modal').classList.remove('open'); });
document.getElementById('btn-alterar-meta').addEventListener('click',()=>{
  const u=liveUsuarios.find(x=>x.id===modalColportorId); if(!u) return;
  mostrarInputModal('Alterar Meta',`Meta atual: ${fmtMoeda(u.meta)}`,'Novo valor em R$',async val=>{
    const n=parseFloat(val);
    if(!isNaN(n)&&n>0){await updateDoc(doc(db,'usuarios',modalColportorId),{meta:n});mostrarToast('Meta alterada!');abrirPerfil(modalColportorId);}
    else mostrarToast('Valor inválido.',true);
  });
});
document.getElementById('btn-resetar-senha').addEventListener('click',()=>{
  mostrarInputModal('Resetar Senha','Nova senha (4 dígitos numéricos):','••••',async val=>{
    if(/^\d{4}$/.test(val)){await updateDoc(doc(db,'usuarios',modalColportorId),{senha:val});mostrarToast('Senha atualizada com sucesso!');}
    else mostrarToast('Senha inválida.',true);
  });
});


// ── PDF INDIVIDUAL DO COLPORTOR ──
document.getElementById('btn-pdf-colportor').addEventListener('click', () => {
  exportarPDFColportor(modalColportorId);
});

function exportarPDFColportor(uid) {
  const u = liveUsuarios.find(x=>x.id===uid);
  if (!u) return;

  const todosRegs   = getRegsUser(uid);
  const regs        = filtrarRegsPorPeriodo(todosRegs, perfilFiltro);
  const hoje        = new Date().toLocaleDateString('pt-BR');

  // Campanha totals (for meta/bolsa section)
  const vistaTotal  = todosRegs.reduce((s,r)=>s+(r.vista||0),0);
  const prazoTotal  = todosRegs.reduce((s,r)=>s+(r.prazo||0),0);
  const falta       = Math.max(0, u.meta - vistaTotal);
  const pctMeta     = u.meta>0 ? Math.min(100,(vistaTotal/u.meta)*100) : 0;
  const devUPdf     = getDevolucaoUser(uid) || {total:0};

  // Period totals
  const pVista      = regs.reduce((s,r)=>s+(r.vista||0),0);
  const pPrazo      = regs.reduce((s,r)=>s+(r.prazo||0),0);
  const pOfertas    = regs.reduce((s,r)=>s+(r.ofertas||0),0);
  const pOracoes    = regs.reduce((s,r)=>s+(r.oracoes||0),0);
  const pHoras      = regs.reduce((s,r)=>s+(r.horas||0),0);
  const pEstudos    = regs.reduce((s,r)=>s+(r.estudos||0),0);
  const pDias       = contarDiasTrabalhados(regs);
  const medPeriodo  = calcMediasDiarias(regs);

  const labelPeriodo = perfilFiltro==='campanha'?'Campanha Completa'
    : perfilFiltro==='semana'?'Últimos 7 Dias'
    : perfilFiltro==='15dias'?'Últimos 15 Dias'
    : perfilFiltro==='mes'?'Este Mês'
    : `${perfilDataIni||''} a ${perfilDataFim||''}`;

  const barW = Math.min(100, pctMeta).toFixed(1);
  const barColor = pctMeta>=100?'#FFB100':pctMeta>=75?'#FFC94D':pctMeta>=50?'#CC8C00':'#B45309';

  // Build rows for period records table
  const regsRev = [...regs].sort((a,b)=>b.data.localeCompare(a.data));
  const rowsHTML = regsRev.length === 0
    ? '<tr><td colspan="6" style="text-align:center;padding:16px;color:#999;">Nenhum registro neste período.</td></tr>'
    : regsRev.map(r=>r.justificado ? `
      <tr style="border-bottom:1px solid #eee;background:#FBF6E9;">
        <td style="padding:8px 6px;">${formatarData(r.data)}<br><span style="font-size:10px;color:#999;">${getDiaSemana(r.data)}</span></td>
        <td colspan="6" style="padding:8px 6px;font-style:italic;color:#555;">
          <span style="display:inline-block;background:#F0E6C8;border:1px solid #FFB100;border-radius:10px;padding:2px 8px;font-size:9px;font-weight:700;color:#B45309;text-transform:uppercase;margin-right:6px;">📢 Justificado</span>
          ${escapeHtml(r.motivoJustificativa)}
        </td>
      </tr>` : `
      <tr style="border-bottom:1px solid #eee;">
        <td style="padding:8px 6px;">${formatarData(r.data)}<br><span style="font-size:10px;color:#999;">${getDiaSemana(r.data)}</span></td>
        <td style="padding:8px 6px;font-family:monospace;color:#1a7a3e;font-weight:700;">R$ ${(r.vista||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
        <td style="padding:8px 6px;font-family:monospace;color:#1565C0;">R$ ${(r.prazo||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
        <td style="padding:8px 6px;text-align:center;">${r.ofertas||0}</td>
        <td style="padding:8px 6px;text-align:center;">${r.oracoes||0}</td>
        <td style="padding:8px 6px;text-align:center;">${r.horas||0}h</td>
        <td style="padding:8px 6px;text-align:center;">${r.estudos||0}</td>
      </tr>`).join('');

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
  <title>Relatório — ${escapeHtml(u.nome)}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:Arial,sans-serif;color:#1a1a2e;background:#fff;font-size:13px;}
    .hdr{background:linear-gradient(135deg,#0a0f1c,#1a2a4a);color:#fff;padding:24px 36px;display:flex;justify-content:space-between;align-items:center;}
    .hdr-left{display:flex;align-items:center;gap:16px;}
    .avatar{width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#FFB100,#B45309);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#000;flex-shrink:0;}
    .hdr-name{font-size:22px;font-weight:800;letter-spacing:0.3px;}
    .hdr-sub{font-size:11px;opacity:0.6;margin-top:3px;}
    .hdr-date{font-size:11px;opacity:0.6;text-align:right;}
    .sec{padding:20px 36px;}
    .sec-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:#0a0f1c;border-bottom:3px solid #FFB100;padding-bottom:5px;margin-bottom:14px;display:inline-block;}
    .bolsa{background:#f5f9f5;border:1px solid #c3e6cb;border-radius:12px;padding:18px;margin-bottom:18px;}
    .bolsa-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #e8e8e8;}
    .bolsa-row:last-child{border-bottom:none;}
    .bolsa-label{font-size:12px;color:#555;font-weight:600;}
    .bolsa-val{font-size:15px;font-weight:800;font-family:monospace;}
    .bar-bg{background:#e0e0e0;border-radius:100px;height:12px;overflow:hidden;margin-top:10px;}
    .bar-fill{height:100%;border-radius:100px;background:linear-gradient(90deg,#B45309,#FFB100,#FFC94D);}
    .bar-label{display:flex;justify-content:space-between;font-size:11px;color:#555;margin-bottom:5px;font-weight:600;}
    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px;}
    .sbox{background:#f5f5f5;border-radius:10px;padding:12px;text-align:center;border-top:3px solid #ccc;}
    .sbox.g{border-color:#FFB100;}.sbox.b{border-color:#1976D2;}.sbox.y{border-color:#FFCE45;}.sbox.o{border-color:#FF6D00;}.sbox.p{border-color:#7B1FA2;}.sbox.v{border-color:#6D28D9;}.sbox.d{border-color:#00796B;}
    .slb{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#777;font-weight:700;margin-bottom:3px;}
    .svl{font-size:18px;font-weight:800;color:#1a1a2e;font-family:monospace;}
    table{width:100%;border-collapse:collapse;font-size:12px;}
    th{background:#0a0f1c;color:#fff;padding:8px 6px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1px;}
    tr:nth-child(even) td{background:#f9f9f9;}
    .ftr{text-align:center;font-size:10px;color:#aaa;padding:14px;border-top:1px solid #eee;margin-top:16px;}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
  </style></head><body>

  <!-- HEADER -->
  <div class="hdr">
    <div class="hdr-left">
      <div class="avatar">${iniciais(u.nome)}</div>
      <div>
        <div class="hdr-name">${escapeHtml(u.nome)}</div>
        <div class="hdr-sub">📞 ${escapeHtml(u.tel)||'—'} · Colportor · Superação Piauí 2026</div>
      </div>
    </div>
    <div class="hdr-date">Gerado em<br><strong>${hoje}</strong><br><span style="font-size:10px;opacity:0.5;">Período: ${labelPeriodo}</span></div>
  </div>

  <!-- BOLSA DE ESTUDOS -->
  <div class="sec">
    <div class="sec-title">🎯 Bolsa de Estudos — Campanha Completa</div>
    <div class="bolsa">
      <div class="bolsa-row"><span class="bolsa-label">🎯 Meta Total</span><span class="bolsa-val" style="color:#B45309;">R$ ${u.meta.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>
      <div class="bolsa-row"><span class="bolsa-label">✅ Vendido À Vista</span><span class="bolsa-val" style="color:#1a7a3e;">R$ ${vistaTotal.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>
      <div class="bolsa-row"><span class="bolsa-label">📋 No Pedido</span><span class="bolsa-val" style="color:#1565C0;">R$ ${prazoTotal.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>
      <div class="bolsa-row"><span class="bolsa-label">⬜ Falta Alcançar</span><span class="bolsa-val" style="color:${falta===0?'#1a7a3e':'#c62828'};">${falta===0?'✅ Meta atingida!':'R$ '+falta.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>
      <div class="bolsa-row"><span class="bolsa-label">📦 Devolução de Material (lacrado)</span><span class="bolsa-val" style="color:#E65100;">R$ ${(devUPdf.total||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>
      <div style="margin-top:12px;">
        <div class="bar-label"><span>Progresso</span><span style="font-weight:800;color:${barColor};">${pctMeta.toFixed(1)}%</span></div>
        <div class="bar-bg"><div class="bar-fill" style="width:${barW}%;background:linear-gradient(90deg,#B45309,#FFB100,#FFC94D);"></div></div>
      </div>
    </div>

    <!-- STATS DO PERÍODO -->
    <div class="sec-title">📊 Resultados — ${labelPeriodo}</div>
    <div class="stats">
      <div class="sbox g"><div class="slb">💰 À Vista</div><div class="svl">R$${(pVista/1000).toFixed(1)}k</div></div>
      <div class="sbox b"><div class="slb">📋 No Pedido</div><div class="svl">R$${(pPrazo/1000).toFixed(1)}k</div></div>
      <div class="sbox y"><div class="slb">📦 Ofertas</div><div class="svl">${pOfertas}</div></div>
      <div class="sbox o"><div class="slb">🙏 Orações</div><div class="svl">${pOracoes}</div></div>
      <div class="sbox p"><div class="slb">⏰ Horas</div><div class="svl">${fmtHoras(pHoras)}</div></div>
      <div class="sbox v"><div class="slb">📖 Estudos</div><div class="svl">${pEstudos}</div></div>
      <div class="sbox d"><div class="slb">📅 Dias Trab.</div><div class="svl">${pDias}</div></div>
    </div>

    <!-- MÉDIAS DIÁRIAS -->
    <div class="sec-title">📊 Médias Diárias — ${labelPeriodo} (por dia registrado)</div>
    <div class="stats" style="grid-template-columns:repeat(4,1fr);margin-bottom:18px;">
      <div class="sbox g"><div class="slb">💰 Média Vendas/dia</div><div class="svl">R$ ${medPeriodo.mediaVendas.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
      <div class="sbox b"><div class="slb">📦 Média Ofertas/dia</div><div class="svl">${medPeriodo.mediaOfertas.toFixed(1)}</div></div>
      <div class="sbox o"><div class="slb">⏰ Média Horas/dia</div><div class="svl">${fmtHoras(medPeriodo.mediaHoras)}</div></div>
      <div class="sbox d"><div class="slb">📅 Dias Trabalhados</div><div class="svl">${medPeriodo.dias}</div></div>
    </div>

    <!-- TABELA DE REGISTROS -->
    <div class="sec-title">📋 Registros do Período</div>
    <table>
      <thead><tr><th>Data</th><th>À Vista</th><th>No Pedido</th><th>Ofertas</th><th>Orações</th><th>Horas</th><th>Estudos</th></tr></thead>
      <tbody>${rowsHTML}</tbody>
    </table>
  </div>

  <div class="ftr">Equipe Superação Piauí · Campanha 2026 · ${hoje}</div>
  <script>window.onload=()=>setTimeout(()=>window.print(),400);<\/script>
  </body></html>`;

  const w = window.open('','_blank');
  w.document.write(html);
  w.document.close();
}

// ── PREENCHIMENTO DIÁRIO ──
function renderPreenchimentoDiario() {
  const el=document.getElementById('diario-data-filtro');
  if (!el.value) el.value=getHoje();
  const data=el.value;
  const regsData=liveRegistros.filter(r=>r.data===data);
  const ids=new Set(regsData.map(r=>r.userId));
  const sim=liveUsuarios.filter(u=>ids.has(u.id));
  const nao=liveUsuarios.filter(u=>!ids.has(u.id));
  document.getElementById('diario-count-sim').textContent=sim.length;
  document.getElementById('diario-count-nao').textContent=nao.length;
  document.getElementById('diario-count-total').textContent=liveUsuarios.length;
  const listaSim=document.getElementById('diario-lista-sim');
  listaSim.innerHTML='';
  if (!sim.length) { listaSim.innerHTML='<div style="text-align:center;padding:16px;color:var(--texto3);font-size:13px;">Nenhum preenchimento.</div>'; }
  else {
    sim.forEach(u=>{
      const reg=regsData.find(r=>r.userId===u.id);
      const div=document.createElement('div');
      div.style.cssText='display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(255,177,0,0.06);border:1px solid rgba(255,177,0,0.15);border-radius:10px;';
      div.innerHTML=`<div style="width:36px;height:36px;flex-shrink:0;border-radius:50%;background:linear-gradient(135deg,var(--verde),var(--azul));display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#000;">${escapeHtml(iniciais(u.nome))}</div><div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:700;color:var(--branco);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(u.nome)}</div><div style="font-size:12px;color:var(--verde-claro);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">À vista: ${fmtMini(reg?.vista||0)} · ${reg?.ofertas||0} ofertas</div></div><div style="font-size:11px;color:var(--verde);font-weight:700;flex-shrink:0;">✅</div>`;
      const btnD=document.createElement('button');
      btnD.textContent='🗑️'; btnD.style.cssText='padding:5px 8px;border-radius:7px;border:1px solid rgba(239,83,80,0.3);background:rgba(239,83,80,0.08);color:#EF9090;cursor:pointer;font-size:12px;';
      if(reg) btnD.addEventListener('click',()=>mostrarConfirm('Apagar registro de '+u.nome+' em '+formatarData(data)+'?','',async()=>{ await deleteDoc(doc(db,'registros',reg.id)); mostrarToast('Apagado.'); }));
      div.appendChild(btnD); listaSim.appendChild(div);
    });
  }
  const listaNao=document.getElementById('diario-lista-nao');
  listaNao.innerHTML='';
  if (!nao.length) { listaNao.innerHTML='<div style="text-align:center;padding:16px;color:var(--verde-claro);font-size:13px;font-weight:700;">🎉 Todos preencheram!</div>'; }
  else {
    nao.forEach(u=>{
      const waLink=u.tel?`https://wa.me/55${u.tel.replace(/\D/g,'')}?text=${encodeURIComponent('Olá '+u.nome.split(' ')[0]+'! Não esqueça de registrar suas vendas de hoje no painel Equipe Superação Piauí! 🙏')}`:'';
      const div=document.createElement('div');
      div.style.cssText='display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(255,109,0,0.07);border:1px solid rgba(255,109,0,0.2);border-radius:10px;flex-wrap:wrap;';
      div.innerHTML=`<div style="width:36px;height:36px;flex-shrink:0;border-radius:50%;background:rgba(255,109,0,0.15);border:1px solid rgba(255,109,0,0.3);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:var(--laranja);">${escapeHtml(iniciais(u.nome))}</div><div style="flex:1;min-width:120px;"><div style="font-size:14px;font-weight:700;color:var(--branco);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(u.nome)}</div><div style="font-size:12px;color:var(--texto3);margin-top:2px;">📞 ${escapeHtml(u.tel)||'—'}</div></div>${waLink?`<a href="${waLink}" target="_blank" style="padding:6px 10px;background:rgba(37,211,102,0.15);border:1px solid rgba(37,211,102,0.3);border-radius:8px;color:#25D366;font-size:11px;font-weight:700;text-decoration:none;white-space:nowrap;flex-shrink:0;">📲 Notificar</a>`:''}`;
      listaNao.appendChild(div);
    });
  }
}
document.getElementById('diario-data-filtro').addEventListener('change', renderPreenchimentoDiario);
document.getElementById('btn-diario-hoje').addEventListener('click',()=>{ document.getElementById('diario-data-filtro').value=getHoje(); renderPreenchimentoDiario(); });

// ── GRÁFICOS ADMIN ──
function renderGraficosAdmin() {
  const regsFiltrados = filtrarRegsGrafico(liveRegistros, graficosAdmFiltro);
  const lblEstAdm = document.getElementById('graf-estudos-adm-label');
  if (lblEstAdm) lblEstAdm.textContent = `📖 Estudos Bíblicos — ${labelFiltroGrafico(graficosAdmFiltro)}`;
  const valEstAdm = document.getElementById('graf-estudos-adm');
  if (valEstAdm) valEstAdm.textContent = regsFiltrados.reduce((s,r)=>s+(r.estudos||0),0);
  const datas=[...new Set(regsFiltrados.map(r=>r.data))].sort();
  const L=datas.map(d=>formatarData(d).slice(0,5));
  const soma=(campo)=>datas.map(d=>regsFiltrados.filter(r=>r.data===d).reduce((s,r)=>s+(r[campo]||0),0));
  criarChart('adm-chart-vendas','line',L,[{data:datas.map(d=>regsFiltrados.filter(r=>r.data===d).reduce((s,r)=>s+(r.vista||0),0)),borderColor:'#FFB100',backgroundColor:'rgba(255,177,0,0.1)',borderWidth:2,fill:true,tension:0.4}]);
  criarChart('adm-chart-ofertas','bar',L,[{data:soma('ofertas'),backgroundColor:'rgba(255,177,0,0.6)',borderRadius:6}]);
  criarChart('adm-chart-oracoes','bar',L,[{data:soma('oracoes'),backgroundColor:'rgba(43,79,242,0.55)',borderRadius:6}]);
  criarChart('adm-chart-horas','line',L,[{data:soma('horas'),borderColor:'#8A5200',backgroundColor:'rgba(192,152,32,0.1)',borderWidth:2,fill:true,tension:0.4}]);
  criarChart('adm-chart-estudos','bar',L,[{data:soma('estudos'),backgroundColor:'rgba(124,58,237,0.6)',borderRadius:6}]);
}

// ── BIND: filtros de período dos gráficos ──
document.querySelectorAll('[data-graf-col]').forEach(btn=>{
  btn.addEventListener('click', function(){
    document.querySelectorAll('[data-graf-col]').forEach(b=>b.classList.remove('active'));
    this.classList.add('active');
    graficosColFiltro = this.getAttribute('data-graf-col');
    renderGraficosColportor();
  });
});
document.querySelectorAll('[data-graf-adm]').forEach(btn=>{
  btn.addEventListener('click', function(){
    document.querySelectorAll('[data-graf-adm]').forEach(b=>b.classList.remove('active'));
    this.classList.add('active');
    graficosAdmFiltro = this.getAttribute('data-graf-adm');
    renderGraficosAdmin();
  });
});

// ── RELATÓRIO GERAL ──
function renderRelatorioGeral() {
  const tv=liveRegistros.reduce((s,r)=>s+(r.vista||0),0);
  const tp=liveRegistros.reduce((s,r)=>s+(r.prazo||0),0);
  const ranking=liveUsuarios.map(u=>{const regsU=getRegsUser(u.id);return {nome:u.nome,vista:getVistaUser(u.id),meta:u.meta,pct:u.meta>0?(getVistaUser(u.id)/u.meta*100).toFixed(1):0,estudos:regsU.reduce((s,r)=>s+(r.estudos||0),0)};}).sort((a,b)=>b.vista-a.vista);
  document.getElementById('adm-relatorio-geral').innerHTML=`
    <div class="section-title" style="margin-bottom:20px">📊 Relatório Geral</div>
    <div class="stats-grid">
      <div class="stat-card green"><div class="stat-label">💰 Total À Vista</div><div class="stat-value" style="font-size:20px">${fmtMini(tv)}</div><div class="stat-sub">Toda a equipe</div></div>
      <div class="stat-card blue"><div class="stat-label">📋 Total no Pedido</div><div class="stat-value" style="font-size:20px">${fmtMini(tp)}</div><div class="stat-sub">Toda a equipe</div></div>
      <div class="stat-card yellow"><div class="stat-label">📦 Total Ofertas</div><div class="stat-value">${liveRegistros.reduce((s,r)=>s+(r.ofertas||0),0)}</div></div>
      <div class="stat-card orange"><div class="stat-label">🙏 Total Orações</div><div class="stat-value">${liveRegistros.reduce((s,r)=>s+(r.oracoes||0),0)}</div></div>
      <div class="stat-card green"><div class="stat-label">📖 Estudos Bíblicos</div><div class="stat-value">${liveRegistros.reduce((s,r)=>s+(r.estudos||0),0)}</div><div class="stat-sub">Toda a equipe</div></div>
      <div class="stat-card blue"><div class="stat-label">👥 Colportores</div><div class="stat-value">${liveUsuarios.length}</div></div>
    </div>
    <div class="divider"></div>
    <div style="font-size:15px;font-weight:700;color:var(--branco);margin-bottom:12px;">🏆 Ranking Final</div>
    ${ranking.map((u,i)=>`<div class="ranking-item"><div class="rank-pos ${i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'rank-other'}">${i+1}</div><div class="rank-info"><div class="rank-name">${escapeHtml(u.nome)}</div><div class="rank-city">Meta: ${fmtMini(u.meta)} · Atingido: ${u.pct}% · 📖 ${u.estudos} estudos</div></div><div class="rank-value">${fmtMini(u.vista)}</div></div>`).join('')}`;
}

// ── MODAIS DASHBOARD ──
window.abrirModalVendasHoje = function() {
  const hoje=getHoje(), regsH=liveRegistros.filter(r=>r.data===hoje);
  const total=regsH.reduce((s,r)=>s+(r.vista||0),0);
  document.getElementById('mvh-data').textContent=new Date(hoje+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'});
  document.getElementById('mvh-total-val').textContent=fmtMoeda(total);
  const lista=document.getElementById('mvh-lista'), empty=document.getElementById('mvh-empty');
  const vend=liveUsuarios.map(u=>{const r=regsH.find(x=>x.userId===u.id);return r?{nome:u.nome,vista:r.vista||0,prazo:r.prazo||0}:null;}).filter(Boolean).sort((a,b)=>b.vista-a.vista);
  if(!vend.length){lista.innerHTML='';empty.style.display='block';}
  else{empty.style.display='none';lista.innerHTML=vend.map((v,i)=>`<div style="background:var(--bg-card2);border:1px solid var(--borda);border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:12px;"><div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--verde),var(--azul));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#000;flex-shrink:0;">${i+1}</div><div style="flex:1;"><div style="font-size:15px;font-weight:700;color:var(--branco);">${v.nome}</div><div style="margin-top:5px;background:rgba(16,26,51,0.06);border-radius:100px;height:6px;"><div style="height:100%;border-radius:100px;width:${total>0?Math.round(v.vista/total*100):0}%;background:var(--ouro);"></div></div></div><div style="text-align:right;"><div style="font-size:18px;font-weight:800;font-family:var(--num-font);color:var(--ouro-claro);">${fmtMini(v.vista)}</div>${v.prazo>0?`<div style="font-size:11px;color:var(--azul-claro);">+${fmtMini(v.prazo)} pedido</div>`:''}</div></div>`).join('');}
  document.getElementById('modal-vendas-hoje').style.display='flex';
};
window.abrirModalColportores = function() {
  const count=document.getElementById('mcol-count');
  count.textContent=liveUsuarios.length+' colportor(es)';
  const lista=document.getElementById('mcol-lista');
  if(!liveUsuarios.length){lista.innerHTML='<div style="text-align:center;padding:24px;color:var(--texto3)">Nenhum cadastrado.</div>';return;}
  lista.innerHTML='';
  [...liveUsuarios].sort((a,b)=>a.nome.localeCompare(b.nome)).forEach(u=>{
    const vista=getVistaUser(u.id), pct=u.meta>0?Math.min(100,(vista/u.meta*100)):0;
    const div=document.createElement('div');
    div.style.cssText='display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--bg-card2);border:1px solid var(--borda);border-radius:10px;cursor:pointer;transition:border-color 0.2s;';
    div.onmouseenter=()=>div.style.borderColor='var(--ouro)';
    div.onmouseleave=()=>div.style.borderColor='';
    div.innerHTML=`<div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--verde),var(--azul));display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:#000;">${escapeHtml(iniciais(u.nome))}</div><div style="flex:1;"><div style="font-size:15px;font-weight:700;color:var(--branco);">${escapeHtml(u.nome)}</div><div style="font-size:12px;color:var(--texto3);">📞 ${escapeHtml(u.tel)||'—'}</div></div><div style="text-align:right;"><div style="font-size:13px;font-weight:700;font-family:var(--num-font);color:${pct>=100?'var(--ouro-claro)':pct>=50?'#3D5DF2':'#FFC94D'};">${pct.toFixed(0)}%</div></div><div style="color:var(--texto2);font-size:16px;">›</div>`;
    div.addEventListener('click',()=>{ document.getElementById('modal-colportores').style.display='none'; abrirPerfil(u.id); });
    lista.appendChild(div);
  });
  document.getElementById('modal-colportores').style.display='flex';
};
document.getElementById('btn-fechar-vendas-hoje').addEventListener('click',()=>document.getElementById('modal-vendas-hoje').style.display='none');
document.getElementById('btn-fechar-colportores').addEventListener('click',()=>document.getElementById('modal-colportores').style.display='none');
document.getElementById('modal-vendas-hoje').addEventListener('click',e=>{ if(e.target===document.getElementById('modal-vendas-hoje')) document.getElementById('modal-vendas-hoje').style.display='none'; });
document.getElementById('modal-colportores').addEventListener('click',e=>{ if(e.target===document.getElementById('modal-colportores')) document.getElementById('modal-colportores').style.display='none'; });

// ── FOTOS ──
// Redimensiona/comprime a imagem no navegador antes de salvar (fotos de celular podem ter vários MB
// e o Firestore tem limite de 1MB por documento). Mantém proporção, lado maior no máximo 480px, JPEG 80%.
function redimensionarImagem(file, maxLado = 480, qualidade = 0.8) {
  return new Promise((resolve, reject) => {
    const imgEl = new Image();
    const urlTemp = URL.createObjectURL(file);
    imgEl.onload = () => {
      URL.revokeObjectURL(urlTemp);
      let { width, height } = imgEl;
      if (width > maxLado || height > maxLado) {
        const escala = maxLado / Math.max(width, height);
        width = Math.round(width * escala);
        height = Math.round(height * escala);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(imgEl, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', qualidade));
    };
    imgEl.onerror = () => { URL.revokeObjectURL(urlTemp); reject(new Error('Não foi possível ler a imagem.')); };
    imgEl.src = urlTemp;
  });
}
document.getElementById('input-foto-perfil').addEventListener('change',async function(){
  if(!this.files[0]||!currentUser) return;
  try {
    const b64 = await redimensionarImagem(this.files[0]);
    await setDoc(doc(db,'fotos','user_'+currentUser.id),{base64:b64});
    const img=document.getElementById('pcol-avatar-img'), ini=document.getElementById('pcol-avatar-ini');
    if (img && ini) { img.src=b64; img.style.display='block'; ini.style.display='none'; }
    mostrarToast('✅ Foto atualizada!');
  } catch(e) {
    mostrarToast('❌ Não foi possível processar a foto.', true);
  }
  this.value='';
});
// foto login removida - logo fixo no sistema

// ── EXPORT ──
// ── EXPORTAR FUNÇÕES ──

function exportarExcelEquipe() {
  const BOM='\uFEFF';
  const linhas=['Nome,Telefone,Meta (R$),Vendas À Vista (R$),Vendas no Pedido (R$),% Meta,Dias,Ofertas,Orações,Horas,Estudos Bíblicos'];
  liveUsuarios.forEach(u=>{
    const regs=getRegsUser(u.id);
    const v=regs.reduce((s,r)=>s+(r.vista||0),0), p=regs.reduce((s,r)=>s+(r.prazo||0),0);
    const pct=u.meta>0?(v/u.meta*100).toFixed(1):0;
    linhas.push(`${csvField(u.nome)},${csvField(u.tel)},${u.meta},${v.toFixed(2)},${p.toFixed(2)},${pct},${contarDiasTrabalhados(regs)},${regs.reduce((s,r)=>s+(r.ofertas||0),0)},${regs.reduce((s,r)=>s+(r.oracoes||0),0)},${regs.reduce((s,r)=>s+(r.horas||0),0)},${regs.reduce((s,r)=>s+(r.estudos||0),0)}`);
  });
  const blob=new Blob([BOM+linhas.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`superacao-equipe-${getHoje()}.csv`; a.click();
}

function exportarExcelRelatorio() {
  const BOM='\uFEFF';
  const tv=liveRegistros.reduce((s,r)=>s+(r.vista||0),0), tp=liveRegistros.reduce((s,r)=>s+(r.prazo||0),0);
  const linhas=[
    'RELATÓRIO GERAL — EQUIPE SUPERAÇÃO PIAUÍ',
    `Gerado em: ${new Date().toLocaleDateString('pt-BR')}`,
    '',
    'RESUMO',
    `Total À Vista (R$),${tv.toFixed(2)}`,
    `Total no Pedido (R$),${tp.toFixed(2)}`,
    `Total Ofertas,${liveRegistros.reduce((s,r)=>s+(r.ofertas||0),0)}`,
    `Total Orações,${liveRegistros.reduce((s,r)=>s+(r.oracoes||0),0)}`,
    `Total Horas,${liveRegistros.reduce((s,r)=>s+(r.horas||0),0)}`,
    `Total Estudos Bíblicos,${liveRegistros.reduce((s,r)=>s+(r.estudos||0),0)}`,
    `Colportores,${liveUsuarios.length}`,
    '',
    'RANKING',
    'Pos,Nome,Telefone,Meta (R$),À Vista (R$),No Pedido (R$),% Meta,Dias,Ofertas,Orações,Horas,Estudos Bíblicos'
  ];
  liveUsuarios.map(u=>{
    const regs=getRegsUser(u.id);
    return {nome:u.nome,tel:u.tel||'',meta:u.meta,
      vista:regs.reduce((s,r)=>s+(r.vista||0),0),prazo:regs.reduce((s,r)=>s+(r.prazo||0),0),
      dias:contarDiasTrabalhados(regs),of:regs.reduce((s,r)=>s+(r.ofertas||0),0),
      or:regs.reduce((s,r)=>s+(r.oracoes||0),0),hr:regs.reduce((s,r)=>s+(r.horas||0),0),est:regs.reduce((s,r)=>s+(r.estudos||0),0)};
  }).sort((a,b)=>b.vista-a.vista).forEach((u,i)=>{
    const pct=u.meta>0?(u.vista/u.meta*100).toFixed(1):0;
    linhas.push(`${i+1},${csvField(u.nome)},${csvField(u.tel)},${u.meta},${u.vista.toFixed(2)},${u.prazo.toFixed(2)},${pct}%,${u.dias},${u.of},${u.or},${u.hr},${u.est||0}`);
  });
  linhas.push('','REGISTROS DIÁRIOS','Nome,Data,À Vista (R$),No Pedido (R$),Ofertas,Orações,Horas,Estudos Bíblicos');
  liveUsuarios.forEach(u=>{
    getRegsUser(u.id).forEach(r=>{
      linhas.push(`${csvField(u.nome)},${formatarData(r.data)},${(r.vista||0).toFixed(2)},${(r.prazo||0).toFixed(2)},${r.ofertas||0},${r.oracoes||0},${r.horas||0},${r.estudos||0}`);
    });
  });
  const blob=new Blob([BOM+linhas.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`superacao-relatorio-${getHoje()}.csv`; a.click();
}

function exportarExcelGraficos() {
  const BOM='\uFEFF';
  const datas=[...new Set(liveRegistros.map(r=>r.data))].sort();
  const linhas=['DADOS DOS GRÁFICOS — EQUIPE SUPERAÇÃO PIAUÍ','','Data,Vendas À Vista (R$),Ofertas,Orações,Horas,Estudos Bíblicos'];
  datas.forEach(d=>{
    const rD=liveRegistros.filter(r=>r.data===d);
    linhas.push(`${formatarData(d)},${rD.reduce((s,r)=>s+(r.vista||0),0).toFixed(2)},${rD.reduce((s,r)=>s+(r.ofertas||0),0)},${rD.reduce((s,r)=>s+(r.oracoes||0),0)},${rD.reduce((s,r)=>s+(r.horas||0),0)},${rD.reduce((s,r)=>s+(r.estudos||0),0)}`);
  });
  const blob=new Blob([BOM+linhas.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`superacao-graficos-${getHoje()}.csv`; a.click();
}

function exportarPDFRelatorio() {
  const hoje=new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'});
  const tv=liveRegistros.reduce((s,r)=>s+(r.vista||0),0);
  const tp=liveRegistros.reduce((s,r)=>s+(r.prazo||0),0);
  const to=liveRegistros.reduce((s,r)=>s+(r.ofertas||0),0);
  const tor=liveRegistros.reduce((s,r)=>s+(r.oracoes||0),0);
  const th=liveRegistros.reduce((s,r)=>s+(r.horas||0),0);
  const test=liveRegistros.reduce((s,r)=>s+(r.estudos||0),0);
  const metaEqAtual = (getCampanhaPorId(campanhaVisualizada) || CAMPANHA_ATIVA)?.metaEquipe || 0;
  const pctEq=(metaEqAtual>0 ? tv/metaEqAtual*100 : 0).toFixed(1);
  const ranking=liveUsuarios.map(u=>{
    const regs=getRegsUser(u.id);
    return {nome:u.nome,meta:u.meta,vista:regs.reduce((s,r)=>s+(r.vista||0),0),
      prazo:regs.reduce((s,r)=>s+(r.prazo||0),0),dias:contarDiasTrabalhados(regs),of:regs.reduce((s,r)=>s+(r.ofertas||0),0),est:regs.reduce((s,r)=>s+(r.estudos||0),0)};
  }).sort((a,b)=>b.vista-a.vista);
  const medals=['🥇','🥈','🥉'];
  const rows=ranking.map((u,i)=>{
    const pct=u.meta>0?(u.vista/u.meta*100).toFixed(1):0;
    const bar=Math.min(100,parseFloat(pct));
    return `<tr style="border-bottom:1px solid #eee;">
      <td style="padding:10px 8px;font-weight:800;font-size:16px;">${medals[i]||i+1+'º'}</td>
      <td style="padding:10px 8px;font-weight:700;">${escapeHtml(u.nome)}</td>
      <td style="padding:10px 8px;color:#1a7a3e;font-weight:800;font-family:monospace;">R$ ${u.vista.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
      <td style="padding:10px 8px;color:#1565C0;font-family:monospace;">R$ ${u.prazo.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
      <td style="padding:10px 8px;font-family:monospace;">R$ ${u.meta.toLocaleString('pt-BR')}</td>
      <td style="padding:10px 8px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="width:70px;height:8px;background:#e0e0e0;border-radius:4px;overflow:hidden;">
            <div style="width:${bar}%;height:100%;background:${bar>=100?'#FFB100':bar>=50?'#1976D2':'#FFCE45'};border-radius:4px;"></div>
          </div>
          <strong style="color:${bar>=100?'#00952D':bar>=50?'#1565C0':'#9a7700'}">${pct}%</strong>
        </div>
      </td>
      <td style="padding:10px 8px;text-align:center;">${u.dias}</td>
      <td style="padding:10px 8px;text-align:center;">${u.of}</td>
      <td style="padding:10px 8px;text-align:center;">${u.est||0}</td>
    </tr>`;
  }).join('');
  const html=`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
  <title>Relatório Superação Piauí</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:Arial,sans-serif;color:#1a1a2e;background:#fff;}
    .hdr{background:linear-gradient(135deg,#0a0f1c,#1a2a4a);color:#fff;padding:28px 40px;display:flex;justify-content:space-between;align-items:center;}
    .hdr-title{font-size:24px;font-weight:800;}
    .hdr-sub{font-size:12px;opacity:0.6;margin-top:3px;}
    .sec{padding:24px 40px;}
    .sec-title{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:#0a0f1c;border-bottom:3px solid #FFB100;padding-bottom:6px;margin-bottom:16px;display:inline-block;}
    .stats{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:24px;}
    .sbox{background:#f5f5f5;border-radius:10px;padding:14px;text-align:center;border-top:4px solid #ccc;}
    .sbox.g{border-color:#FFB100;}.sbox.b{border-color:#B45309;}.sbox.y{border-color:#FFCE45;}.sbox.o{border-color:#FF6D00;}.sbox.p{border-color:#7B1FA2;}.sbox.v{border-color:#6D28D9;}
    .slb{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;font-weight:700;margin-bottom:4px;}
    .svl{font-size:20px;font-weight:800;color:#1a1a2e;font-family:monospace;}
    .mbar{background:#f0f9f4;border:1px solid #c3e6cb;border-radius:10px;padding:16px;margin-bottom:20px;}
    .mbarlbl{display:flex;justify-content:space-between;font-size:12px;font-weight:700;color:#1a7a3e;margin-bottom:8px;}
    .mbarbg{background:#ddd;border-radius:100px;height:14px;overflow:hidden;}
    .mbarfil{height:100%;border-radius:100px;background:linear-gradient(90deg,#B45309,#FFB100,#FFC94D);}
    table{width:100%;border-collapse:collapse;font-size:13px;}
    th{background:#0a0f1c;color:#fff;padding:10px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1px;}
    tr:nth-child(even) td{background:#f9f9f9;}
    .ftr{text-align:center;font-size:11px;color:#999;padding:16px;border-top:1px solid #eee;margin-top:20px;}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
  </style></head><body>
  <div class="hdr">
    <div><div class="hdr-title">🏆 Superação Piauí — Relatório</div><div class="hdr-sub">Campanha de Colportagem 2026</div></div>
    <div style="font-size:12px;opacity:0.7;text-align:right;">Gerado em<br><strong>${hoje}</strong></div>
  </div>
  <div class="sec">
    <div class="sec-title">Resumo Geral</div>
    <div class="stats">
      <div class="sbox g"><div class="slb">💰 À Vista</div><div class="svl">R$${(tv/1000).toFixed(1)}k</div></div>
      <div class="sbox b"><div class="slb">📋 No Pedido</div><div class="svl">R$${(tp/1000).toFixed(1)}k</div></div>
      <div class="sbox y"><div class="slb">📦 Ofertas</div><div class="svl">${to}</div></div>
      <div class="sbox o"><div class="slb">🙏 Orações</div><div class="svl">${tor}</div></div>
      <div class="sbox p"><div class="slb">⏰ Horas</div><div class="svl">${fmtHoras(th)}</div></div>
      <div class="sbox v"><div class="slb">📖 Estudos</div><div class="svl">${test}</div></div>
    </div>
    <div class="mbar">
      <div class="mbarlbl"><span>🎯 Meta da Equipe: R$ 410.000</span><span>Alcançado: ${pctEq}% — R$ ${tv.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>
      <div class="mbarbg"><div class="mbarfil" style="width:${Math.min(100,parseFloat(pctEq))}%"></div></div>
    </div>
    <div class="sec-title">🏆 Ranking Final</div>
    <table><thead><tr><th>#</th><th>Nome</th><th>À Vista</th><th>No Pedido</th><th>Meta</th><th>% Meta</th><th>Dias</th><th>Ofertas</th><th>Estudos</th></tr></thead>
    <tbody>${rows}</tbody></table>
  </div>
  <div class="ftr">Equipe Superação Piauí · Campanha 2026 · ${hoje}</div>
  <script>window.onload=()=>setTimeout(()=>window.print(),500);<\/script>
  </body></html>`;
  const w=window.open('','_blank','width=1000,height=700');
  if(w){w.document.write(html);w.document.close();}
  else mostrarToast('Permita pop-ups para exportar PDF.',true);
}

function exportarPDFGraficos() {
  const hoje=new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'});
  const ids=['adm-chart-vendas','adm-chart-ofertas','adm-chart-oracoes','adm-chart-horas','adm-chart-estudos'];
  const titulos=['Vendas por Dia (À Vista)','Ofertas por Dia','Orações por Dia','Horas Trabalhadas','Estudos Bíblicos por Dia'];
  const cores=['#FFB100','#1976D2','#FFCE45','#FF6D00','#6D28D9'];
  const imgs=ids.map(id=>{const c=document.getElementById(id);return c?c.toDataURL('image/png'):null;});
  const blocos=imgs.map((img,i)=>img?`
    <div style="background:#f8f9fa;border-radius:10px;padding:16px;border-top:4px solid ${cores[i]};">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#555;margin-bottom:10px;">${titulos[i]}</div>
      <img src="${img}" alt="${escapeHtml(titulos[i])}" style="width:100%;height:auto;border-radius:6px;">
    </div>`:'').join('');
  const html=`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Gráficos Superação Piauí</title>
  <style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:Arial,sans-serif;color:#1a1a2e;}
  .hdr{background:linear-gradient(135deg,#0a0f1c,#1a2a4a);color:#fff;padding:24px 36px;display:flex;justify-content:space-between;align-items:center;}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:24px 36px;}
  .ftr{text-align:center;font-size:11px;color:#999;padding:14px;border-top:1px solid #eee;}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}</style></head><body>
  <div class="hdr">
    <div><div style="font-size:20px;font-weight:800;">📈 Gráficos da Equipe</div><div style="font-size:11px;opacity:0.6;margin-top:3px;">Superação Piauí · Campanha 2026</div></div>
    <div style="font-size:11px;opacity:0.7;text-align:right;">Gerado em<br><strong>${hoje}</strong></div>
  </div>
  <div class="grid">${blocos}</div>
  <div class="ftr">Equipe Superação Piauí · ${hoje}</div>
  <script>window.onload=()=>setTimeout(()=>window.print(),500);<\/script>
  </body></html>`;
  const w=window.open('','_blank','width=1000,height=700');
  if(w){w.document.write(html);w.document.close();}
  else mostrarToast('Permita pop-ups para exportar PDF.',true);
}

document.getElementById('btn-exportar-csv').addEventListener('click', exportarExcelEquipe);
document.getElementById('btn-relatorio-pdf').addEventListener('click', exportarPDFRelatorio);
document.getElementById('btn-relatorio-excel').addEventListener('click', exportarExcelRelatorio);
document.getElementById('btn-graficos-pdf').addEventListener('click', exportarPDFGraficos);
document.getElementById('btn-graficos-excel').addEventListener('click', exportarExcelGraficos);

// ── CONSTANTS LÍDER ──
let LIDER_REL_SENHA = '4321';
let currentLider = null;

// ── LOGIN / LOGOUT LÍDER ──
document.getElementById('btn-abrir-lider-login').onclick = function() {
  document.getElementById('lider-login-area').style.display = 'block';
  document.getElementById('btn-abrir-lider-login').style.display = 'none';
  document.getElementById('lider-login-error').style.display = 'none';
  document.getElementById('lider-login-nome').value = '';
  document.getElementById('lider-login-senha').value = '';
  setTimeout(()=>document.getElementById('lider-login-nome').focus(), 80);
};
document.getElementById('btn-fechar-lider-login').onclick = function() {
  document.getElementById('lider-login-area').style.display = 'none';
  document.getElementById('btn-abrir-lider-login').style.display = 'block';
};
document.getElementById('btn-confirmar-lider-login').onclick = async function() {
  const nome  = document.getElementById('lider-login-nome').value.trim();
  const senha = document.getElementById('lider-login-senha').value.trim();
  const err   = document.getElementById('lider-login-error');
  err.style.display = 'none';
  if (!nome || !senha) { err.textContent='Preencha nome e senha.'; err.style.display='block'; return; }
  if (!CAMPANHA_ATIVA) { err.textContent='Carregando dados da campanha, aguarde um instante e tente novamente.'; err.style.display='block'; return; }
  try {
    const snap = await getDocs(query(collection(db,'lideres'), where('nomeLC','==',nome.toLowerCase()), where('campanhaId','==',CAMPANHA_ATIVA.id)));
    if (snap.empty) { err.textContent='Nome ou senha inválidos.'; err.style.display='block'; return; }
    const liderDoc = snap.docs.find(d=>d.data().senha===senha);
    if (!liderDoc) { err.textContent='Nome ou senha inválidos.'; err.style.display='block'; return; }
    currentLider = { id: liderDoc.id, ...liderDoc.data() };
    document.getElementById('nav-nome-lider').textContent = currentLider.nome.split(' ')[0];
    showScreen('screen-lider');
    document.getElementById('l-reg-data').value = getHoje();
    bindTodasMascaras();
    await renderLiderPainel();
    await renderAgendaLider();
  } catch(e) { err.textContent='Erro: '+e.message; err.style.display='block'; }
};
document.getElementById('lider-login-senha').onkeydown = function(e) {
  if(e.key==='Enter') document.getElementById('btn-confirmar-lider-login').onclick();
};
document.getElementById('btn-logout-lider').onclick = function() {
  currentLider = null;
  showScreen('screen-login');
  document.getElementById('lider-login-area').style.display = 'none';
  document.getElementById('btn-abrir-lider-login').style.display = 'block';
};

// ── PAINEL DO LÍDER ──
function popularSelectColportoresLider() {
  const sel = document.getElementById('l-reg-colportor');
  if (!sel) return;
  const atual = sel.value;
  const colportores = liveUsuarios.filter(u => u.tipo !== 'admin' && u.tipo !== 'lider').sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
  sel.innerHTML = '<option value="">Selecione...</option>' + colportores.map(u => `<option value="${u.id}">${escapeHtml(u.nome)}</option>`).join('');
  if (colportores.some(u=>u.id===atual)) sel.value = atual;
}
async function renderLiderPainel() {
  if (!currentLider) return;
  popularSelectColportoresLider();
  try {
    const snap = await getDocs(query(collection(db,'lider_registros'), where('liderId','==',currentLider.id)));
    const regs = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>b.data.localeCompare(a.data));
    const alvo          = currentLider.alvo || 0;
    const totalVista    = regs.reduce((s,r)=>s+(r.vista||0),0);
    const totalPrazo    = regs.reduce((s,r)=>s+(r.prazo||0),0);
    const totalHoras    = regs.reduce((s,r)=>s+(r.horas||0),0);
    const totalEstudos  = regs.reduce((s,r)=>s+(r.estudos||0),0);
    const totalVisitas  = regs.reduce((s,r)=>s+(r.visitas||0),0);
    const falta = Math.max(0, alvo - totalVista);
    const pct   = alvo > 0 ? Math.min(100,(totalVista/alvo)*100) : 0;
    document.getElementById('l-alvo-display').textContent      = fmtMini(alvo);
    document.getElementById('l-alcancado-display').textContent = fmtMini(totalVista);
    document.getElementById('l-falta-display').textContent     = falta>0?fmtMini(falta):'✅ Atingido!';
    document.getElementById('l-falta-display').style.color     = falta===0?'var(--ouro-claro)':'var(--amarelo)';
    document.getElementById('l-pct-display').textContent       = pct.toFixed(1)+'%';
    document.getElementById('l-bar-display').style.width       = pct+'%';
    document.getElementById('l-prazo-display').textContent     = fmtMini(totalPrazo);
    document.getElementById('l-horas-display').textContent     = fmtHoras(totalHoras);
    document.getElementById('l-estudos-display').textContent   = totalEstudos;
    document.getElementById('l-visitas-display').textContent   = totalVisitas;
    const tbody = document.getElementById('l-historico-body');
    if (!regs.length) { tbody.innerHTML='<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--texto3)">Nenhum registro ainda.</td></tr>'; return; }
    tbody.innerHTML = regs.map(r=>`
      <tr>
        <td>${formatarData(r.data)}</td>
        <td style="font-weight:700;color:var(--branco)">${escapeHtml(r.colportor)||'—'}</td>
        <td class="color-green">${fmtMini(r.vista||0)}</td>
        <td style="color:var(--azul-claro);font-family:var(--num-font)">${fmtMini(r.prazo||0)}</td>
        <td style="font-family:var(--num-font)">${r.horas||0}h</td>
        <td style="font-family:var(--num-font)">${r.estudos||0}</td>
        <td style="font-family:var(--num-font)">${r.visitas||0}</td>
        <td><button data-l-del="${r.id}" style="padding:5px 10px;border-radius:7px;border:1px solid rgba(239,83,80,0.3);background:rgba(239,83,80,0.08);color:#EF9090;font-family:Inter,sans-serif;font-size:11px;font-weight:700;cursor:pointer;">🗑️</button></td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-l-del]').forEach(btn=>btn.addEventListener('click',function(){
      const rid=this.getAttribute('data-l-del');
      mostrarConfirm('Apagar este registro?','Esta ação não pode ser desfeita.',async()=>{
        await deleteDoc(doc(db,'lider_registros',rid));
        mostrarToast('Registro apagado.');
        renderLiderPainel();
      });
    }));
  } catch(e) { console.warn('renderLiderPainel:', e); }
}

// Salvar registro do líder
document.getElementById('btn-l-salvar-reg').addEventListener('click', async ()=>{
  if (!currentLider) return;
  const data        = document.getElementById('l-reg-data').value;
  const colportorSel = document.getElementById('l-reg-colportor');
  const colportorId = colportorSel.value;
  const colportor   = colportorSel.selectedOptions[0]?.textContent || '';
  const vista     = moedaParaFloat(document.getElementById('l-reg-vista').value);
  const prazo     = moedaParaFloat(document.getElementById('l-reg-prazo').value);
  const horas     = parseFloat(document.getElementById('l-reg-horas').value)||0;
  const estudos   = parseInt(document.getElementById('l-reg-estudos').value)||0;
  const visitas   = parseInt(document.getElementById('l-reg-visitas').value)||0;
  const msgEl     = document.getElementById('l-reg-msg');
  if (!data||!colportorId) { msgEl.textContent='⚠️ Preencha data e selecione o colportor.'; msgEl.style.color='var(--danger)'; msgEl.style.display='block'; return; }
  try {
    showSyncStatus('💾 Salvando...','saving');
    const regId = Date.now().toString();
    await setDoc(doc(db,'lider_registros',regId),{liderId:currentLider.id,liderNome:currentLider.nome,campanhaId:currentLider.campanhaId,data,colportor,colportorId,vista,prazo,horas,estudos,visitas,criadoEm:getHoje()});
    showSyncStatus('✅ Salvo!','saved');
    msgEl.textContent='✅ Registro salvo!'; msgEl.style.color='var(--ouro-claro)'; msgEl.style.display='block';
    setTimeout(()=>msgEl.style.display='none',2500);
    document.getElementById('l-reg-colportor').value='';
    document.getElementById('l-reg-vista').value='';
    document.getElementById('l-reg-prazo').value='';
    document.getElementById('l-reg-horas').value='';
    document.getElementById('l-reg-estudos').value='';
    document.getElementById('l-reg-visitas').value='';
    renderLiderPainel();
  } catch(e) { msgEl.textContent='❌ Erro: '+e.message; msgEl.style.color='var(--danger)'; msgEl.style.display='block'; }
});

// ── ADMIN: GESTÃO DE LÍDERES ──
async function renderAreaLider() {
  await renderAdmLiderLista();
  await renderAdmAgenda();
  document.getElementById('adm-rel-lider-conteudo').style.display = 'none';
  document.getElementById('adm-rel-lider-auth').style.display = 'block';
  document.getElementById('adm-rel-lider-senha-input').value = '';
  document.getElementById('adm-rel-lider-auth-err').style.display = 'none';
}

async function renderAdmLiderLista() {
  const lista = document.getElementById('adm-lider-lista');
  try {
    const snap = campanhaVisualizada
      ? await getDocs(query(collection(db,'lideres'), where('campanhaId','==',campanhaVisualizada)))
      : await getDocs(collection(db,'lideres'));
    const lideres = snap.docs.map(d=>({id:d.id,...d.data()}));
    const btnNovo = document.getElementById('btn-adm-novo-lider');
    btnNovo.style.display = lideres.length >= 3 ? 'none' : 'inline-block';
    if (!lideres.length) { lista.innerHTML='<div style="text-align:center;padding:16px;color:var(--texto3);font-size:13px;">Nenhum líder cadastrado ainda.</div>'; return; }
    lista.innerHTML = '';
    lideres.forEach(l => {
      const div = document.createElement('div');
      div.style.cssText='display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(255,177,0,0.05);border:1px solid rgba(255,177,0,0.15);border-radius:10px;';
      div.innerHTML=`<div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#FFB100,#B45309);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:#000;">${escapeHtml(iniciais(l.nome))}</div><div style="flex:1;"><div style="font-size:15px;font-weight:700;color:var(--branco);">${escapeHtml(l.nome)}</div><div style="font-size:12px;color:var(--texto3);">Alvo: ${fmtMini(l.alvo||0)} · Senha: <span class="senha-mascarada" data-senha="${escapeHtml(l.senha)}" style="letter-spacing:2px;color:var(--texto2);cursor:pointer;" title="Clique para mostrar/ocultar">••••</span></div></div><button data-del-lider="${l.id}" style="padding:6px 10px;border-radius:7px;border:1px solid rgba(239,83,80,0.3);background:rgba(239,83,80,0.08);color:#EF9090;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;">🗑️</button>`;
      div.querySelector('[data-del-lider]').addEventListener('click', function(){
        const lid=this.getAttribute('data-del-lider');
        mostrarConfirm('Remover este líder?','Os registros de assistência serão mantidos.',async()=>{
          await deleteDoc(doc(db,'lideres',lid));
          mostrarToast('Líder removido.');
          renderAdmLiderLista();
        });
      });
      lista.appendChild(div);
    });
  } catch(e) { lista.innerHTML='<div style="color:var(--danger);font-size:13px;">Erro ao carregar líderes.</div>'; }
}

document.getElementById('btn-adm-novo-lider').addEventListener('click', ()=>{
  document.getElementById('adm-form-novo-lider').style.display='block';
  document.getElementById('btn-adm-novo-lider').style.display='none';
  document.getElementById('adm-novo-lider-nome').value='';
  document.getElementById('adm-novo-lider-alvo').value='';
  document.getElementById('adm-novo-lider-senha').value='';
  document.getElementById('adm-novo-lider-msg').style.display='none';
});
document.getElementById('btn-adm-cancelar-lider').addEventListener('click', ()=>{
  document.getElementById('adm-form-novo-lider').style.display='none';
  document.getElementById('btn-adm-novo-lider').style.display='inline-block';
});
document.getElementById('btn-adm-salvar-lider').addEventListener('click', async ()=>{
  const nome  = document.getElementById('adm-novo-lider-nome').value.trim();
  const alvo  = moedaParaFloat(document.getElementById('adm-novo-lider-alvo').value);
  const senha = document.getElementById('adm-novo-lider-senha').value.trim();
  const msgEl = document.getElementById('adm-novo-lider-msg');
  if (!nome||!senha) { msgEl.textContent='⚠️ Preencha nome e senha.'; msgEl.style.color='var(--danger)'; msgEl.style.display='block'; return; }
  if (!/^\d{4}$/.test(senha)) { msgEl.textContent='⚠️ Senha deve ter 4 dígitos numéricos.'; msgEl.style.color='var(--danger)'; msgEl.style.display='block'; return; }
  if (!CAMPANHA_ATIVA) { msgEl.textContent='⚠️ Carregando dados da campanha, tente novamente.'; msgEl.style.color='var(--danger)'; msgEl.style.display='block'; return; }
  try {
    const snap = await getDocs(query(collection(db,'lideres'), where('campanhaId','==',CAMPANHA_ATIVA.id)));
    if (snap.size >= 3) { msgEl.textContent='⚠️ Máximo de 3 líderes atingido nesta campanha.'; msgEl.style.color='var(--danger)'; msgEl.style.display='block'; return; }
    const dup = snap.docs.find(d=>d.data().nomeLC===nome.toLowerCase());
    if (dup) { msgEl.textContent='⚠️ Já existe um líder com este nome nesta campanha.'; msgEl.style.color='var(--danger)'; msgEl.style.display='block'; return; }
    showSyncStatus('💾 Salvando...','saving');
    const id = Date.now().toString();
    await setDoc(doc(db,'lideres',id),{nome,nomeLC:nome.toLowerCase(),alvo,senha,campanhaId:CAMPANHA_ATIVA.id,criadoEm:getHoje()});
    showSyncStatus('✅ Salvo!','saved');
    msgEl.textContent='✅ Líder cadastrado!'; msgEl.style.color='var(--ouro-claro)'; msgEl.style.display='block';
    setTimeout(()=>{ document.getElementById('adm-form-novo-lider').style.display='none'; document.getElementById('adm-novo-lider-msg').style.display='none'; document.getElementById('btn-adm-novo-lider').style.display='inline-block'; },1500);
    renderAdmLiderLista();
  } catch(e) { msgEl.textContent='❌ Erro: '+e.message; msgEl.style.color='var(--danger)'; msgEl.style.display='block'; }
});

// ── ADMIN: RELATÓRIOS DOS LÍDERES (senha 4321) ──
document.getElementById('btn-adm-rel-lider-ok').addEventListener('click', async ()=>{
  const s = document.getElementById('adm-rel-lider-senha-input').value.trim();
  const errEl = document.getElementById('adm-rel-lider-auth-err');
  if (s !== LIDER_REL_SENHA) { errEl.style.display='block'; document.getElementById('adm-rel-lider-senha-input').value=''; return; }
  errEl.style.display='none';
  document.getElementById('adm-rel-lider-auth').style.display='none';
  document.getElementById('adm-rel-lider-conteudo').style.display='block';
  await renderAdmRelLideres();
});
document.getElementById('adm-rel-lider-senha-input').onkeydown = function(e){
  if(e.key==='Enter') document.getElementById('btn-adm-rel-lider-ok').click();
};

async function renderAdmRelLideres() {
  const selector = document.getElementById('adm-lider-selector');
  const corpo    = document.getElementById('adm-lider-relatorio-body');
  try {
    const snap = campanhaVisualizada
      ? await getDocs(query(collection(db,'lideres'), where('campanhaId','==',campanhaVisualizada)))
      : await getDocs(collection(db,'lideres'));
    const lideres = snap.docs.map(d=>({id:d.id,...d.data()}));
    if (!lideres.length) { corpo.innerHTML='<div style="text-align:center;padding:24px;color:var(--texto3);">Nenhum líder cadastrado.</div>'; return; }
    selector.innerHTML = lideres.map((l,i)=>`
      <button data-lider-id="${l.id}" style="padding:8px 16px;border-radius:100px;border:1px solid ${i===0?'var(--ouro)':'rgba(255,177,0,0.2)'};background:${i===0?'linear-gradient(135deg,#FFB100,#B45309)':'transparent'};color:${i===0?'#000':'var(--texto3)'};font-family:Inter,sans-serif;font-size:12px;font-weight:700;cursor:pointer;transition:all 0.15s;">${escapeHtml(l.nome)}</button>
    `).join('');
    selector.querySelectorAll('[data-lider-id]').forEach(btn=>{
      btn.addEventListener('click',function(){
        selector.querySelectorAll('[data-lider-id]').forEach(b=>{ b.style.background='transparent';b.style.borderColor='rgba(255,177,0,0.2)';b.style.color='var(--texto3)'; });
        this.style.background='linear-gradient(135deg,#FFB100,#B45309)';this.style.borderColor='var(--ouro)';this.style.color='#000';
        const lid=this.getAttribute('data-lider-id');
        const liderObj=lideres.find(x=>x.id===lid);
        renderAdmRelUmLider(liderObj,corpo);
      });
    });
    await renderAdmRelUmLider(lideres[0], corpo);
  } catch(e) { corpo.innerHTML='<div style="color:var(--danger);font-size:13px;">Erro ao carregar.</div>'; }
}

async function renderAdmRelUmLider(lider, corpo) {
  try {
    const snap = await getDocs(query(collection(db,'lider_registros'), where('liderId','==',lider.id)));
    const regs = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>b.data.localeCompare(a.data));
    const alvo          = lider.alvo || 0;
    const totalVista    = regs.reduce((s,r)=>s+(r.vista||0),0);
    const totalPrazo    = regs.reduce((s,r)=>s+(r.prazo||0),0);
    const totalHoras    = regs.reduce((s,r)=>s+(r.horas||0),0);
    const totalEstudos  = regs.reduce((s,r)=>s+(r.estudos||0),0);
    const totalVisitas  = regs.reduce((s,r)=>s+(r.visitas||0),0);
    const falta = Math.max(0, alvo - totalVista);
    const pct   = alvo > 0 ? Math.min(100,(totalVista/alvo)*100) : 0;
    corpo.innerHTML = `
      <div style="background:linear-gradient(135deg,rgba(255,177,0,0.07),rgba(180,83,9,0.05));border:1px solid rgba(255,177,0,0.2);border-radius:14px;padding:20px;margin-bottom:16px;">
        <div style="font-size:14px;font-weight:800;color:var(--branco);margin-bottom:12px;">👑 ${lider.nome} — Resumo</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:14px;">
          <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--ouro);"><div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">🎯 Alvo</div><div style="font-size:15px;font-weight:800;font-family:var(--num-font);color:#3D5DF2;">${fmtMini(alvo)}</div></div>
          <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--ouro-claro);"><div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">💰 À Vista</div><div style="font-size:15px;font-weight:800;font-family:var(--num-font);color:var(--ouro-claro);">${fmtMini(totalVista)}</div></div>
          <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--azul-medio);"><div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">📋 No Pedido</div><div style="font-size:15px;font-weight:800;font-family:var(--num-font);color:var(--azul-claro);">${fmtMini(totalPrazo)}</div></div>
          <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid var(--laranja);"><div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">⏰ Horas</div><div style="font-size:15px;font-weight:800;font-family:var(--num-font);color:#FFAB40;">${fmtHoras(totalHoras)}</div></div>
          <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid #6D28D9;"><div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">📖 Estudos</div><div style="font-size:15px;font-weight:800;font-family:var(--num-font);color:#A78BFA;">${totalEstudos}</div></div>
          <div style="background:var(--bg-card2);border-radius:10px;padding:12px;text-align:center;border-left:3px solid #10B981;"><div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700;">🤝 Visitas</div><div style="font-size:15px;font-weight:800;font-family:var(--num-font);color:#6EE7B7;">${totalVisitas}</div></div>
        </div>
        <div style="margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:var(--texto3);font-weight:600;">Progresso do alvo</span>
          <span style="font-size:16px;font-weight:800;font-family:var(--num-font);color:var(--ouro-claro);">${pct.toFixed(1)}%</span>
        </div>
        <div style="background:rgba(16,26,51,0.07);border-radius:100px;height:12px;overflow:hidden;">
          <div style="height:100%;border-radius:100px;width:${pct}%;background:linear-gradient(90deg,#B45309,#FFB100,#FFC94D);"></div>
        </div>
      </div>
      ${regs.length===0?'<div style="text-align:center;padding:24px;color:var(--texto3);">Nenhum registro ainda.</div>':`
      <div class="table-wrap">
        <table class="admin-table">
          <thead><tr><th>Data</th><th>Colportor Assistido</th><th>À Vista</th><th>No Pedido</th><th>Horas</th><th>Estudos</th><th>Visitas</th></tr></thead>
          <tbody>${regs.map(r=>`<tr><td>${formatarData(r.data)}</td><td style="font-weight:700;color:var(--branco)">${escapeHtml(r.colportor)||'—'}</td><td class="color-green">${fmtMini(r.vista||0)}</td><td style="color:var(--azul-claro);font-family:var(--num-font)">${fmtMini(r.prazo||0)}</td><td style="font-family:var(--num-font)">${r.horas||0}h</td><td style="font-family:var(--num-font)">${r.estudos||0}</td><td style="font-family:var(--num-font)">${r.visitas||0}</td></tr>`).join('')}</tbody>
        </table>
      </div>`}
    `;
  } catch(e) { corpo.innerHTML='<div style="color:var(--danger);">Erro ao carregar registros.</div>'; }
}


// ── PERFIL DO COLPORTOR ──
function abrirPerfilColportor() {
  if (!currentUser) return;
  const regs  = getRegsUser(currentUser.id);
  const vista  = regs.reduce((s,r)=>s+(r.vista||0),0);
  const pct    = currentUser.meta>0?Math.min(100,(vista/currentUser.meta)*100):0;

  // Populate header
  document.getElementById('pcol-nome').textContent = currentUser.nome;
  document.getElementById('pcol-tel').textContent  = '📞 '+(currentUser.tel||'—');
  document.getElementById('pcol-meta').textContent    = fmtMini(currentUser.meta);
  document.getElementById('pcol-vendido').textContent = fmtMini(vista);
  document.getElementById('pcol-pct').textContent     = pct.toFixed(1)+'%';

  // Populate avatar
  const ini = document.getElementById('pcol-avatar-ini');
  const img = document.getElementById('pcol-avatar-img');
  ini.textContent = iniciais(currentUser.nome);
  getDoc(doc(db,'fotos','user_'+currentUser.id)).then(d=>{
    if(d.exists()&&d.data().base64){img.src=d.data().base64;img.style.display='block';ini.style.display='none';}
    else{img.style.display='none';ini.style.display='block';}
  }).catch(()=>{});

  // Pre-fill nome input
  document.getElementById('pcol-input-nome').value = currentUser.nome;

  // Reset messages
  ['pcol-msg-nome','pcol-msg-senha','pcol-msg-meta'].forEach(id=>{
    const el=document.getElementById(id); el.style.display='none'; el.textContent='';
  });

  // Highlight current meta option
  document.querySelectorAll('.pcol-meta-opt').forEach(btn=>{
    const val = btn.getAttribute('data-val');
    const isActive = parseFloat(val)===currentUser.meta;
    btn.style.background   = isActive?'linear-gradient(135deg,#FFB100,#B45309)':'transparent';
    btn.style.borderColor  = isActive?'var(--ouro)':'rgba(255,177,0,0.15)';
    btn.style.color        = isActive?'#000':'var(--texto3)';
    btn.style.fontWeight   = isActive?'800':'600';
  });
  document.getElementById('pcol-input-meta').value = '';

  document.getElementById('modal-perfil-col').style.display='flex';
}

function fecharPerfilColportor() {
  document.getElementById('modal-perfil-col').style.display='none';
}

function showPerfilMsg(id, msg, ok=true) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.style.color = ok ? 'var(--ouro-claro)' : 'var(--danger)';
  el.style.display = 'block';
  setTimeout(()=>el.style.display='none', 3000);
}

// Bind modal backdrop close
document.getElementById('modal-perfil-col').addEventListener('click', e=>{
  if(e.target===document.getElementById('modal-perfil-col')) fecharPerfilColportor();
});

// ── Alterar Nome ──
document.getElementById('pcol-btn-nome').addEventListener('click', async ()=>{
  const novoNome = document.getElementById('pcol-input-nome').value.trim();
  if (!novoNome || novoNome.length < 3) {
    showPerfilMsg('pcol-msg-nome','⚠️ Nome deve ter pelo menos 3 caracteres.',false); return;
  }
  if (novoNome.toLowerCase() === currentUser.nome.toLowerCase()) {
    showPerfilMsg('pcol-msg-nome','⚠️ Nome igual ao atual.',false); return;
  }
  // Check if name already exists
  try {
    const snap = await getDocs(query(collection(db,'usuarios'), where('nomeLC','==',novoNome.toLowerCase())));
    if (!snap.empty && snap.docs[0].id !== currentUser.id) {
      showPerfilMsg('pcol-msg-nome','⚠️ Este nome já está em uso.',false); return;
    }
    showSyncStatus('💾 Salvando...','saving');
    await updateDoc(doc(db,'usuarios',currentUser.id), { nome:novoNome, nomeLC:novoNome.toLowerCase() });
    currentUser.nome = novoNome;
    document.getElementById('pcol-nome').textContent = novoNome;
    document.getElementById('pcol-avatar-ini').textContent = iniciais(novoNome);
    showSyncStatus('✅ Salvo!','saved');
    showPerfilMsg('pcol-msg-nome','✅ Nome alterado com sucesso!');
  } catch(e) { showPerfilMsg('pcol-msg-nome','❌ Erro: '+e.message,false); }
});

// ── Alterar Senha ──
document.getElementById('pcol-btn-senha').addEventListener('click', async ()=>{
  const atual = document.getElementById('pcol-input-senha-atual').value.trim();
  const nova  = document.getElementById('pcol-input-senha-nova').value.trim();
  if (atual !== currentUser.senha) {
    showPerfilMsg('pcol-msg-senha','⚠️ Senha atual incorreta.',false); return;
  }
  if (!/^\d{4}$/.test(nova)) {
    showPerfilMsg('pcol-msg-senha','⚠️ Nova senha deve ter 4 dígitos.',false); return;
  }
  if (nova === atual) {
    showPerfilMsg('pcol-msg-senha','⚠️ Nova senha igual à atual.',false); return;
  }
  try {
    showSyncStatus('💾 Salvando...','saving');
    await updateDoc(doc(db,'usuarios',currentUser.id), { senha:nova });
    currentUser.senha = nova;
    document.getElementById('pcol-input-senha-atual').value='';
    document.getElementById('pcol-input-senha-nova').value='';
    showSyncStatus('✅ Salvo!','saved');
    showPerfilMsg('pcol-msg-senha','✅ Senha alterada com sucesso!');
  } catch(e) { showPerfilMsg('pcol-msg-senha','❌ Erro: '+e.message,false); }
});

// ── Alterar Meta (botões rápidos) ──
document.querySelectorAll('.pcol-meta-opt').forEach(btn=>{
  btn.addEventListener('click', function(){
    const val = parseFloat(this.getAttribute('data-val'));
    document.getElementById('pcol-input-meta').value = val;
    document.querySelectorAll('.pcol-meta-opt').forEach(b=>{
      b.style.background  = 'transparent';
      b.style.borderColor = 'rgba(16,26,51,0.12)';
      b.style.color       = 'var(--texto3)';
      b.style.fontWeight  = '600';
    });
    this.style.background  = 'linear-gradient(135deg,#FFB100,#B45309)';
    this.style.borderColor = 'var(--ouro)';
    this.style.color       = '#000';
    this.style.fontWeight  = '800';
  });
});

// ── Alterar Meta (salvar) ──
document.getElementById('pcol-btn-meta').addEventListener('click', async ()=>{
  const novaMeta = parseFloat(document.getElementById('pcol-input-meta').value);
  if (!novaMeta || novaMeta < 1000) {
    showPerfilMsg('pcol-msg-meta','⚠️ Informe um valor válido (mínimo R$ 1.000).',false); return;
  }
  if (novaMeta === currentUser.meta) {
    showPerfilMsg('pcol-msg-meta','⚠️ Meta igual à atual.',false); return;
  }
  try {
    showSyncStatus('💾 Salvando...','saving');
    await updateDoc(doc(db,'usuarios',currentUser.id), { meta:novaMeta });
    currentUser.meta = novaMeta;
    document.getElementById('pcol-meta').textContent = fmtMini(novaMeta);
    // Refresh painel
    renderPainel();
    showSyncStatus('✅ Salvo!','saved');
    showPerfilMsg('pcol-msg-meta','✅ Meta alterada para '+fmtMoeda(novaMeta)+'!');
  } catch(e) { showPerfilMsg('pcol-msg-meta','❌ Erro: '+e.message,false); }
});

// ══════════════════════════════════════════════════════════════════
// SEMANA MÁXIMA — Gestão de competições por equipes
// ══════════════════════════════════════════════════════════════════

// ── Helpers ──
function smaxTipoLabel(tipo) {
  return { semana:'Semana Máxima', quinzena:'Quinzena Máxima', mes:'Mês Máximo', outro:'Atividade Especial' }[tipo] || tipo;
}

function smaxStatusComp(comp) {
  const hoje = getHoje();
  if (hoje < comp.inicio) return 'pendente';
  if (hoje > comp.fim)    return 'encerrada';
  return 'ativa';
}

function smaxStatusBadge(status) {
  if (status==='ativa')     return '<span style="background:rgba(0,200,80,0.15);border:1px solid rgba(0,200,80,0.35);border-radius:100px;padding:3px 10px;font-size:10px;font-weight:800;color:#00C850;text-transform:uppercase;letter-spacing:1px;">🟢 Ativa</span>';
  if (status==='pendente')  return '<span style="background:rgba(255,206,69,0.12);border:1px solid rgba(255,206,69,0.3);border-radius:100px;padding:3px 10px;font-size:10px;font-weight:800;color:#FFCE45;text-transform:uppercase;letter-spacing:1px;">⏳ Aguardando</span>';
  return '<span style="background:rgba(200,200,200,0.1);border:1px solid rgba(200,200,200,0.2);border-radius:100px;padding:3px 10px;font-size:10px;font-weight:800;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;">✅ Encerrada</span>';
}

// ── Calcular ranking das equipes (vendas à vista no período) ──
function smaxRankingEquipes(comp) {
  if (!comp.equipes) return [];
  return comp.equipes.map((equipe, idx) => {
    const total = (equipe.membros || []).reduce((soma, uid) => {
      const regsNoP = liveRegistros.filter(r =>
        r.userId === uid && r.data >= comp.inicio && r.data <= comp.fim
      );
      return soma + regsNoP.reduce((s, r) => s + (r.vista || 0), 0);
    }, 0);
    return { idx, nome: equipe.nome, membros: equipe.membros || [], total };
  }).sort((a, b) => b.total - a.total);
}

// ── Calcular ranking individual (colportor contra colportor, vendas à vista no período) ──
function smaxRankingIndividual(comp) {
  const cols = liveUsuarios.filter(u => u.tipo !== 'lider' && u.tipo !== 'admin');
  return cols.map(u => {
    const regsNoP = liveRegistros.filter(r =>
      r.userId === u.id && r.data >= comp.inicio && r.data <= comp.fim
    );
    const total = regsNoP.reduce((s, r) => s + (r.vista || 0), 0);
    return { id: u.id, nome: u.nome, total };
  }).sort((a, b) => b.total - a.total);
}

// ── Render Admin: Semana Máxima ──
let smaxEditId = null;
let smaxCompAtual = null;

async function renderSmaxAdmin() {
  await renderSmaxLista();
  await renderSmaxBannerAtivo();
}

async function renderSmaxBannerAtivo() {
  try {
    const snap = await getDocs(collection(db, 'competicoes'));
    const comps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const ativa = comps.find(c => smaxStatusComp(c) === 'ativa');
    const banner = document.getElementById('smax-banner-ativo');
    if (!ativa) { banner.style.display = 'none'; return; }
    banner.style.display = 'block';
    document.getElementById('smax-banner-nome').textContent = ativa.nome + ' — ' + smaxTipoLabel(ativa.tipo);
    document.getElementById('smax-banner-periodo').textContent =
      `📅 ${formatarData(ativa.inicio)} até ${formatarData(ativa.fim)}`;
    // Premio destaque no banner ativo
    let bannerPremioEl = document.getElementById('smax-banner-premio');
    if (!bannerPremioEl) {
      bannerPremioEl = document.createElement('div');
      bannerPremioEl.id = 'smax-banner-premio';
      document.getElementById('smax-banner-periodo').insertAdjacentElement('afterend', bannerPremioEl);
    }
    if (ativa.premioTipo) {
      bannerPremioEl.innerHTML = `
        <div style="display:inline-flex;align-items:center;gap:10px;background:linear-gradient(135deg,rgba(255,206,69,0.15),rgba(255,177,0,0.1));border:1px solid rgba(255,206,69,0.4);border-radius:12px;padding:10px 16px;margin-top:10px;margin-bottom:4px;">
          <span style="font-size:26px;">🏆</span>
          <div>
            <div style="font-size:10px;color:rgba(255,206,69,0.7);font-weight:800;text-transform:uppercase;letter-spacing:1.5px;">Premiação</div>
            <div style="font-size:18px;font-weight:900;color:#FFCE45;font-family:var(--display-font);letter-spacing:0.5px;">${ativa.premioTipo}</div>
            ${ativa.premioNome ? `<div style="font-size:13px;color:var(--ouro-claro);font-weight:600;margin-top:1px;">${ativa.premioNome}</div>` : ''}
          </div>
        </div>`;
      bannerPremioEl.style.display = 'block';
    } else {
      bannerPremioEl.style.display = 'none';
    }
    const ehIndividual = (ativa.modelo || 'equipes') === 'individual';
    const ranking = ehIndividual ? smaxRankingIndividual(ativa).slice(0,10) : smaxRankingEquipes(ativa);
    const medalhas = ['🥇','🥈','🥉'];
    document.getElementById('smax-ranking-rapido').innerHTML = ranking.map((eq, i) => `
      <div style="display:flex;align-items:center;gap:12px;background:rgba(16,26,51,0.04);border:1px solid rgba(16,26,51,0.07);border-radius:10px;padding:10px 14px;">
        <span style="font-size:22px;">${medalhas[i]||'🏅'}</span>
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:800;color:var(--branco);">${eq.nome}</div>
          ${ehIndividual ? '' : `<div style="font-size:11px;color:var(--texto3);">${eq.membros.length} colportor(es)</div>`}
        </div>
        <div style="font-family:var(--num-font);font-size:20px;font-weight:800;color:${i===0?'var(--amarelo)':i===1?'var(--rank-silver)':'var(--rank-bronze)'};">${fmtMini(eq.total)}</div>
      </div>`).join('');
  } catch(e) { console.warn('banner:', e); }
}

async function renderSmaxLista() {
  const lista = document.getElementById('smax-lista');
  try {
    const snap = await getDocs(collection(db, 'competicoes'));
    const comps = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => b.inicio.localeCompare(a.inicio));
    if (!comps.length) {
      lista.innerHTML = '<div style="text-align:center;padding:32px;color:var(--texto3);font-size:13px;">Nenhuma competição cadastrada ainda.</div>';
      return;
    }
    lista.innerHTML = comps.map(comp => {
      const status = smaxStatusComp(comp);
      const ehIndividual = (comp.modelo || 'equipes') === 'individual';
      const ranking = ehIndividual ? smaxRankingIndividual(comp).slice(0,10) : smaxRankingEquipes(comp);
      const medalhas = ['🥇','🥈','🥉'];
      return `
      <div style="border:1px solid rgba(255,177,0,0.15);border-radius:14px;padding:18px;margin-bottom:14px;background:rgba(16,26,51,0.02);">
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
          <div style="flex:1;">
            <div style="font-size:16px;font-weight:800;color:var(--branco);margin-bottom:4px;">${comp.nome}</div>
            <div style="font-size:11px;color:var(--texto3);margin-bottom:8px;">🏷️ ${smaxTipoLabel(comp.tipo)} · 📅 ${formatarData(comp.inicio)} → ${formatarData(comp.fim)}</div>
            <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(100,180,255,0.08);border:1px solid rgba(100,180,255,0.25);border-radius:100px;padding:3px 10px;font-size:10px;font-weight:800;color:#87CEEB;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">
              ${ehIndividual ? '👤 Colportor x Colportor' : '👥 Equipes'}
            </div>
            ${comp.premioTipo ? `
            <div style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,rgba(255,177,0,0.18),rgba(180,83,9,0.12));border:1px solid rgba(255,177,0,0.45);border-radius:10px;padding:8px 14px;margin-bottom:10px;">
              <span style="font-size:20px;">🏆</span>
              <div>
                <div style="font-size:10px;color:var(--texto3);font-weight:700;text-transform:uppercase;letter-spacing:1px;line-height:1;">Premiação</div>
                <div style="font-size:15px;font-weight:800;color:var(--ouro-claro);line-height:1.3;">${comp.premioTipo}</div>
                ${comp.premioNome ? `<div style="font-size:12px;color:var(--texto2);font-weight:600;margin-top:1px;">${comp.premioNome}</div>` : ''}
              </div>
            </div>` : ''}
            ${smaxStatusBadge(status)}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${ehIndividual ? '' : `<button data-smax-equipes="${comp.id}" style="padding:7px 12px;border-radius:8px;border:1px solid rgba(255,177,0,0.3);background:rgba(255,177,0,0.08);color:var(--ouro-claro);font-family:var(--body-font);font-size:11px;font-weight:700;cursor:pointer;">👥 Equipes</button>`}
            <button data-smax-edit="${comp.id}" style="padding:7px 12px;border-radius:8px;border:1px solid rgba(100,180,255,0.3);background:rgba(100,180,255,0.07);color:#87CEEB;font-family:var(--body-font);font-size:11px;font-weight:700;cursor:pointer;">✏️ Editar</button>
            <button data-smax-del="${comp.id}" style="padding:7px 12px;border-radius:8px;border:1px solid rgba(239,83,80,0.3);background:rgba(239,83,80,0.07);color:#EF9090;font-family:var(--body-font);font-size:11px;font-weight:700;cursor:pointer;">🗑️ Apagar</button>
          </div>
        </div>
        ${ranking.length ? `
        <div style="display:grid;gap:6px;">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin-bottom:4px;">${ehIndividual ? 'Ranking dos Colportores' : 'Ranking das Equipes'} (Vendas à Vista)</div>
          ${ranking.map((eq, i) => `
          <div style="display:flex;align-items:center;gap:10px;background:rgba(16,26,51,0.03);border-radius:8px;padding:8px 12px;">
            <span style="font-size:18px;">${medalhas[i]||'🏅'}</span>
            <div style="flex:1;font-size:13px;font-weight:700;color:var(--branco);">${eq.nome} ${ehIndividual ? '' : `<span style="color:var(--texto3);font-weight:500;font-size:11px;">(${eq.membros.length} col.)</span>`}</div>
            <div style="font-family:var(--num-font);font-size:16px;font-weight:800;color:${i===0?'var(--amarelo)':i===1?'#C0C0C0':'#CD7F32'};">${fmtMini(eq.total)}</div>
          </div>`).join('')}
        </div>` : `<div style="font-size:12px;color:var(--texto3);">${ehIndividual ? 'Nenhum colportor cadastrado.' : 'Nenhuma equipe configurada.'}</div>`}
      </div>`;
    }).join('');

    lista.querySelectorAll('[data-smax-del]').forEach(btn => {
      btn.addEventListener('click', function() {
        const id = this.getAttribute('data-smax-del');
        mostrarConfirm('Apagar competição?', 'Esta ação não pode ser desfeita.', async () => {
          await deleteDoc(doc(db, 'competicoes', id));
          mostrarToast('Competição apagada.');
          renderSmaxAdmin();
        });
      });
    });

    lista.querySelectorAll('[data-smax-edit]').forEach(btn => {
      btn.addEventListener('click', async function() {
        const id = this.getAttribute('data-smax-edit');
        const snap = await getDoc(doc(db, 'competicoes', id));
        if (!snap.exists()) return;
        const comp = { id: snap.id, ...snap.data() };
        smaxEditId = id;
        document.getElementById('smax-nome').value = comp.nome;
        document.getElementById('smax-tipo').value = comp.tipo;
        document.getElementById('smax-inicio').value = comp.inicio;
        document.getElementById('smax-fim').value = comp.fim;
        // Modelo da competição (competições antigas sem esse campo são tratadas como "equipes")
        smaxLimparModelosSelecionados();
        const modeloAtual = comp.modelo || 'equipes';
        const modeloBtnEl = document.querySelector(`.smax-modelo-btn[data-modelo="${modeloAtual}"]`);
        if (modeloBtnEl) smaxSelecionarModelo(modeloBtnEl);
        // Premiação
        smaxLimparPremiosSelecionados();
        if (comp.premioTipo) {
          const btn = document.querySelector(`.smax-premio-btn[data-premio="${comp.premioTipo}"]`);
          if (btn) smaxSelecionarPremio(btn);
        }
        document.getElementById('smax-premio-nome').value = comp.premioNome || '';
        document.getElementById('smax-form').style.display = 'block';
        document.getElementById('btn-smax-toggle-form').style.display = 'none';
        document.getElementById('smax-form-msg').style.display = 'none';
        document.getElementById('smax-form').scrollIntoView({ behavior: 'smooth' });
      });
    });

    lista.querySelectorAll('[data-smax-equipes]').forEach(btn => {
      btn.addEventListener('click', async function() {
        const id = this.getAttribute('data-smax-equipes');
        await abrirGestaoEquipes(id);
      });
    });
  } catch(e) {
    lista.innerHTML = '<div style="color:var(--danger);font-size:13px;">Erro ao carregar competições.</div>';
  }
}

// ── Gestão de Equipes ──
async function abrirGestaoEquipes(compId) {
  const secao = document.getElementById('smax-section-equipes');
  secao.style.display = 'block';
  secao.scrollIntoView({ behavior: 'smooth' });
  await renderGestaoEquipes(compId);
}

async function renderGestaoEquipes(compId) {
  const secao = document.getElementById('smax-section-equipes');
  try {
    const snapComp = await getDoc(doc(db, 'competicoes', compId));
    if (!snapComp.exists()) return;
    const comp = { id: snapComp.id, ...snapComp.data() };
    smaxCompAtual = comp;
    const equipes = comp.equipes || [];
    const todosCols = liveUsuarios.filter(u => u.tipo !== 'lider' && u.tipo !== 'admin');
    const membrosUsados = equipes.flatMap(e => e.membros || []);
    const disponiveis = todosCols.filter(u => !membrosUsados.includes(u.id));

    secao.innerHTML = `
      <div class="card-header" style="margin-bottom:16px;">
        <div class="card-title">👥 Equipes — ${comp.nome}</div>
        <button id="btn-smax-fechar-equipes" style="padding:7px 12px;border-radius:8px;border:1px solid rgba(16,26,51,0.12);background:transparent;color:var(--texto2);font-family:var(--body-font);font-size:12px;font-weight:700;cursor:pointer;">✕ Fechar</button>
      </div>

      <!-- Criar nova equipe -->
      <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap;">
        <input type="text" id="smax-nova-equipe-nome" placeholder="Nome da equipe" style="flex:1;min-width:160px;background:rgba(255,177,0,0.04);border:1px solid rgba(255,177,0,0.2);border-radius:8px;padding:10px 14px;color:var(--branco);font-family:var(--body-font);font-size:13px;outline:none;">
        <button id="btn-smax-add-equipe" style="padding:10px 16px;border-radius:8px;border:none;background:linear-gradient(135deg,#FFB100,#B45309);color:#000;font-family:var(--body-font);font-size:12px;font-weight:900;cursor:pointer;white-space:nowrap;">+ Criar Equipe</button>
      </div>

      <!-- Colportores disponíveis -->
      <div style="margin-bottom:16px;">
        <div style="font-size:11px;color:var(--texto3);text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin-bottom:8px;">Colportores sem equipe (${disponiveis.length})</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${disponiveis.length ? disponiveis.map(u => `
            <div style="background:rgba(16,26,51,0.05);border:1px solid rgba(16,26,51,0.1);border-radius:100px;padding:6px 12px;font-size:12px;font-weight:600;color:var(--texto2);cursor:default;">👤 ${escapeHtml(u.nome)}</div>
          `).join('') : '<div style="font-size:12px;color:var(--texto3);">Todos os colportores estão em equipes.</div>'}
        </div>
      </div>

      <!-- Equipes existentes -->
      <div id="smax-equipes-lista">
        ${equipes.length ? equipes.map((eq, idx) => smaxRenderEquipeCard(eq, idx, comp, todosCols)).join('') :
          '<div style="text-align:center;padding:20px;color:var(--texto3);font-size:13px;">Nenhuma equipe criada.</div>'}
      </div>
    `;

    secao.querySelector('#btn-smax-fechar-equipes').addEventListener('click', () => {
      secao.style.display = 'none';
      smaxCompAtual = null;
    });

    secao.querySelector('#btn-smax-add-equipe').addEventListener('click', async () => {
      const nome = secao.querySelector('#smax-nova-equipe-nome').value.trim();
      if (!nome) { mostrarToast('Informe o nome da equipe.', true); return; }
      const novasEquipes = [...equipes, { nome, membros: [] }];
      await updateDoc(doc(db, 'competicoes', compId), { equipes: novasEquipes });
      mostrarToast('Equipe criada!');
      renderGestaoEquipes(compId);
    });

    // Bind add member buttons
    secao.querySelectorAll('[data-smax-add-membro]').forEach(btn => {
      btn.addEventListener('click', async function() {
        const eqIdx = parseInt(this.getAttribute('data-eq-idx'));
        const uid = this.getAttribute('data-smax-add-membro');
        const novasEquipes = [...equipes];
        if (!novasEquipes[eqIdx].membros) novasEquipes[eqIdx].membros = [];
        if (!novasEquipes[eqIdx].membros.includes(uid)) novasEquipes[eqIdx].membros.push(uid);
        await updateDoc(doc(db, 'competicoes', compId), { equipes: novasEquipes });
        renderGestaoEquipes(compId);
      });
    });

    // Bind remove member buttons
    secao.querySelectorAll('[data-smax-rem-membro]').forEach(btn => {
      btn.addEventListener('click', async function() {
        const eqIdx = parseInt(this.getAttribute('data-eq-idx'));
        const uid = this.getAttribute('data-smax-rem-membro');
        const novasEquipes = [...equipes];
        novasEquipes[eqIdx].membros = (novasEquipes[eqIdx].membros || []).filter(m => m !== uid);
        await updateDoc(doc(db, 'competicoes', compId), { equipes: novasEquipes });
        renderGestaoEquipes(compId);
      });
    });

    // Bind delete equipe buttons
    secao.querySelectorAll('[data-smax-del-equipe]').forEach(btn => {
      btn.addEventListener('click', async function() {
        const eqIdx = parseInt(this.getAttribute('data-smax-del-equipe'));
        mostrarConfirm('Apagar esta equipe?', 'Os colportores ficarão sem equipe.', async () => {
          const novasEquipes = equipes.filter((_, i) => i !== eqIdx);
          await updateDoc(doc(db, 'competicoes', compId), { equipes: novasEquipes });
          mostrarToast('Equipe removida.');
          renderGestaoEquipes(compId);
        });
      });
    });

  } catch(e) {
    secao.innerHTML = `<div style="color:var(--danger);font-size:13px;">Erro: ${e.message}</div>`;
  }
}

function smaxRenderEquipeCard(eq, idx, comp, todosCols) {
  const membrosInfo = (eq.membros || []).map(uid => todosCols.find(u => u.id === uid)).filter(Boolean);
  const membrosUsados = (comp.equipes || []).flatMap(e => e.membros || []);
  const disponiveis = todosCols.filter(u => !membrosUsados.includes(u.id));
  const cores = ['rgba(255,177,0,0.08)','rgba(100,150,255,0.08)','rgba(255,107,74,0.08)','rgba(0,200,150,0.08)'];
  const bordas = ['rgba(255,177,0,0.25)','rgba(100,150,255,0.25)','rgba(255,107,74,0.25)','rgba(0,200,150,0.25)'];
  return `
  <div style="background:${cores[idx%4]};border:1px solid ${bordas[idx%4]};border-radius:12px;padding:16px;margin-bottom:12px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
      <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#FFB100,#8A5200);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#000;">${idx+1}</div>
      <div style="font-size:15px;font-weight:800;color:var(--branco);flex:1;">${eq.nome}</div>
      <button data-smax-del-equipe="${idx}" style="padding:5px 9px;border-radius:7px;border:1px solid rgba(239,83,80,0.3);background:rgba(239,83,80,0.07);color:#EF9090;font-family:var(--body-font);font-size:11px;font-weight:700;cursor:pointer;">🗑️</button>
    </div>

    <!-- Membros atuais -->
    <div style="margin-bottom:10px;">
      <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:6px;">Membros (${membrosInfo.length})</div>
      ${membrosInfo.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${membrosInfo.map(u => `
          <div style="display:flex;align-items:center;gap:6px;background:rgba(16,26,51,0.06);border:1px solid rgba(16,26,51,0.1);border-radius:8px;padding:5px 8px;">
            <span style="font-size:12px;font-weight:600;color:var(--branco);">👤 ${escapeHtml(u.nome)}</span>
            <button data-eq-idx="${idx}" data-smax-rem-membro="${u.id}" style="width:18px;height:18px;border-radius:50%;border:none;background:rgba(239,83,80,0.4);color:#fff;font-size:10px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;">✕</button>
          </div>`).join('')}
      </div>` : '<div style="font-size:12px;color:var(--texto3);">Sem membros ainda.</div>'}
    </div>

    <!-- Adicionar membro -->
    ${disponiveis.length ? `
    <div>
      <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:6px;">Adicionar à equipe</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${disponiveis.map(u => `
          <button data-eq-idx="${idx}" data-smax-add-membro="${u.id}" style="padding:5px 10px;border-radius:8px;border:1px solid rgba(255,177,0,0.25);background:rgba(255,177,0,0.06);color:var(--ouro-claro);font-family:var(--body-font);font-size:11px;font-weight:700;cursor:pointer;">+ ${escapeHtml(u.nome)}</button>
        `).join('')}
      </div>
    </div>` : ''}
  </div>`;
}

// ── Funções de Modelo da Competição ──
function smaxLimparModelosSelecionados() {
  document.querySelectorAll('.smax-modelo-btn').forEach(b => {
    b.style.background = 'transparent';
    b.style.borderColor = 'rgba(255,177,0,0.25)';
    b.style.color = 'var(--texto2)';
    b.removeAttribute('data-selected');
  });
}
function smaxSelecionarModelo(btn) {
  smaxLimparModelosSelecionados();
  btn.style.background = 'linear-gradient(135deg,rgba(255,177,0,0.25),rgba(180,83,9,0.15))';
  btn.style.borderColor = 'var(--ouro)';
  btn.style.color = 'var(--ouro-claro)';
  btn.setAttribute('data-selected', '1');
}
document.querySelectorAll('.smax-modelo-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    smaxSelecionarModelo(this);
    const secaoEquipes = document.getElementById('smax-section-equipes');
    if (this.getAttribute('data-modelo') === 'individual' && secaoEquipes) secaoEquipes.style.display = 'none';
  });
});

// ── Funções de Premiação ──
function smaxLimparPremiosSelecionados() {
  document.querySelectorAll('.smax-premio-btn').forEach(b => {
    b.style.background = 'transparent';
    b.style.borderColor = 'rgba(255,177,0,0.25)';
    b.style.color = 'var(--texto2)';
    b.removeAttribute('data-selected');
  });
}
function smaxSelecionarPremio(btn) {
  smaxLimparPremiosSelecionados();
  btn.style.background = 'linear-gradient(135deg,rgba(255,177,0,0.25),rgba(180,83,9,0.15))';
  btn.style.borderColor = 'var(--ouro)';
  btn.style.color = 'var(--ouro-claro)';
  btn.setAttribute('data-selected', '1');
}
document.querySelectorAll('.smax-premio-btn').forEach(btn => {
  btn.addEventListener('click', function() { smaxSelecionarPremio(this); });
});

// ── Form criar/editar ──
document.getElementById('btn-smax-toggle-form').addEventListener('click', () => {
  smaxEditId = null;
  document.getElementById('smax-nome').value = '';
  document.getElementById('smax-tipo').value = 'semana';
  document.getElementById('smax-inicio').value = '';
  document.getElementById('smax-fim').value = '';
  document.getElementById('smax-premio-nome').value = '';
  smaxLimparPremiosSelecionados();
  smaxLimparModelosSelecionados();
  smaxSelecionarModelo(document.querySelector('.smax-modelo-btn[data-modelo="individual"]'));
  document.getElementById('smax-form-msg').style.display = 'none';
  document.getElementById('smax-form').style.display = 'block';
  document.getElementById('btn-smax-toggle-form').style.display = 'none';
});

document.getElementById('btn-smax-cancelar').addEventListener('click', () => {
  document.getElementById('smax-form').style.display = 'none';
  document.getElementById('btn-smax-toggle-form').style.display = 'inline-block';
  smaxEditId = null;
});

document.getElementById('btn-smax-salvar').addEventListener('click', async () => {
  const nome   = document.getElementById('smax-nome').value.trim();
  const tipo   = document.getElementById('smax-tipo').value;
  const inicio = document.getElementById('smax-inicio').value;
  const fim    = document.getElementById('smax-fim').value;
  const modeloBtn = document.querySelector('.smax-modelo-btn[data-selected]');
  const modelo = modeloBtn ? modeloBtn.getAttribute('data-modelo') : 'individual';
  const premioBtn = document.querySelector('.smax-premio-btn[data-selected]');
  const premioTipo = premioBtn ? premioBtn.getAttribute('data-premio') : '';
  const premioNome = document.getElementById('smax-premio-nome').value.trim();
  const msgEl  = document.getElementById('smax-form-msg');
  if (!nome || !inicio || !fim) {
    msgEl.textContent = '⚠️ Preencha todos os campos.';
    msgEl.style.color = 'var(--danger)'; msgEl.style.display = 'block'; return;
  }
  if (fim < inicio) {
    msgEl.textContent = '⚠️ Data de encerramento deve ser após o início.';
    msgEl.style.color = 'var(--danger)'; msgEl.style.display = 'block'; return;
  }
  try {
    showSyncStatus('💾 Salvando...', 'saving');
    if (smaxEditId) {
      await updateDoc(doc(db, 'competicoes', smaxEditId), { nome, tipo, inicio, fim, modelo, premioTipo, premioNome });
    } else {
      const id = 'comp_' + Date.now();
      await setDoc(doc(db, 'competicoes', id), { nome, tipo, inicio, fim, modelo, premioTipo, premioNome, equipes: [], criadoEm: getHoje() });
    }
    showSyncStatus('✅ Salvo!', 'saved');
    msgEl.textContent = smaxEditId ? '✅ Competição atualizada!' : '✅ Competição criada!';
    msgEl.style.color = 'var(--ouro-claro)'; msgEl.style.display = 'block';
    smaxEditId = null;
    setTimeout(() => {
      document.getElementById('smax-form').style.display = 'none';
      document.getElementById('btn-smax-toggle-form').style.display = 'inline-block';
      document.getElementById('smax-form-msg').style.display = 'none';
      renderSmaxAdmin();
    }, 1200);
  } catch(e) {
    msgEl.textContent = '❌ Erro: ' + e.message;
    msgEl.style.color = 'var(--danger)'; msgEl.style.display = 'block';
    showSyncStatus('❌ Erro', 'error');
  }
});

// ── Render Colportor: Semana Máxima (leitura) ──
async function renderSmaxColportor() {
  const container = document.getElementById('col-smax-container');
  try {
    const snap = await getDocs(collection(db, 'competicoes'));
    const comps = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ord = { ativa: 0, pendente: 1, encerrada: 2 };
        return (ord[smaxStatusComp(a)] || 9) - (ord[smaxStatusComp(b)] || 9);
      });
    if (!comps.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">🏅</div><div>Nenhuma competição cadastrada.</div></div>';
      return;
    }
    const medalhas = ['🥇','🥈','🥉'];
    container.innerHTML = comps.map(comp => {
      const status = smaxStatusComp(comp);
      const ehIndividual = (comp.modelo || 'equipes') === 'individual';
      const ranking = ehIndividual ? smaxRankingIndividual(comp).slice(0,10) : smaxRankingEquipes(comp);
      // Check if current user belongs to any team (só aplicável no modelo de equipes)
      const minhaEquipeIdx = (!ehIndividual && currentUser) ? (comp.equipes||[]).findIndex(eq => (eq.membros||[]).includes(currentUser.id)) : -1;
      const minhaEquipeRankIdx = minhaEquipeIdx >= 0 ? ranking.findIndex(r => r.idx === minhaEquipeIdx) : -1;
      const meuRankIdx = (ehIndividual && currentUser) ? ranking.findIndex(r => r.id === currentUser.id) : -1;
      return `
      <div style="background:${status==='ativa'?'linear-gradient(135deg,rgba(255,107,74,0.07),rgba(255,177,0,0.05))':'rgba(16,26,51,0.02)'};border:1px solid ${status==='ativa'?'rgba(255,107,74,0.3)':'rgba(255,177,0,0.12)'};border-radius:16px;padding:20px;margin-bottom:16px;position:relative;overflow:hidden;">
        ${status==='ativa'?'<div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#FF6B00,#FFCE45,#FF6B00);"></div>':''}
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
          <div style="flex:1;">
            <div style="font-size:17px;font-weight:800;color:var(--branco);margin-bottom:4px;">${comp.nome}</div>
            <div style="font-size:11px;color:var(--texto3);margin-bottom:8px;">🏷️ ${smaxTipoLabel(comp.tipo)} · 📅 ${formatarData(comp.inicio)} → ${formatarData(comp.fim)}</div>
            ${smaxStatusBadge(status)}
          </div>
          ${minhaEquipeIdx>=0?`<div style="background:rgba(255,177,0,0.15);border:1px solid rgba(255,177,0,0.3);border-radius:8px;padding:8px 12px;text-align:center;"><div style="font-size:10px;color:var(--texto3);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;">Minha Equipe</div><div style="font-size:13px;font-weight:800;color:var(--ouro-claro);">${(comp.equipes||[])[minhaEquipeIdx]?.nome||''}</div>${minhaEquipeRankIdx>=0?`<div style="font-size:16px;margin-top:2px;">${medalhas[minhaEquipeRankIdx]||'🏅'}</div>`:''}</div>`:''}
          ${meuRankIdx>=0?`<div style="background:rgba(255,177,0,0.15);border:1px solid rgba(255,177,0,0.3);border-radius:8px;padding:8px 12px;text-align:center;"><div style="font-size:10px;color:var(--texto3);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;">Minha Posição</div><div style="font-size:16px;">${medalhas[meuRankIdx]||('#'+(meuRankIdx+1))}</div></div>`:''}
        </div>
        ${comp.premioTipo ? `
        <div style="display:flex;align-items:center;gap:12px;background:linear-gradient(135deg,rgba(255,206,69,0.12),rgba(255,177,0,0.07));border:1px solid rgba(255,206,69,0.35);border-radius:14px;padding:14px 18px;margin-bottom:14px;">
          <span style="font-size:32px;filter:drop-shadow(0 0 8px rgba(255,206,69,0.5));">🏆</span>
          <div>
            <div style="font-size:10px;color:rgba(255,206,69,0.65);font-weight:800;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:2px;">Premiação</div>
            <div style="font-size:20px;font-weight:900;color:#FFCE45;font-family:var(--display-font);letter-spacing:0.5px;line-height:1.2;">${comp.premioTipo}</div>
            ${comp.premioNome ? `<div style="font-size:13px;color:var(--ouro-claro);font-weight:600;margin-top:3px;">✨ ${comp.premioNome}</div>` : ''}
          </div>
        </div>` : ''}
        ${ranking.length ? `
        <div style="display:grid;gap:6px;">
          <div style="font-size:10px;color:var(--texto3);text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin-bottom:4px;">📊 ${ehIndividual ? 'Ranking dos Colportores' : 'Ranking'} (Vendas à Vista)</div>
          ${ranking.map((eq, i) => {
            const isMinhaEquipe = (minhaEquipeIdx >= 0 && eq.idx === minhaEquipeIdx);
            const souEu = (ehIndividual && currentUser && eq.id === currentUser.id);
            const destaque = isMinhaEquipe || souEu;
            return `
            <div style="display:flex;align-items:center;gap:10px;background:${destaque?'rgba(255,177,0,0.12)':'rgba(16,26,51,0.03)'};border:1px solid ${destaque?'rgba(255,177,0,0.3)':'rgba(16,26,51,0.06)'};border-radius:10px;padding:10px 14px;">
              <span style="font-size:20px;">${medalhas[i]||'🏅'}</span>
              <div style="flex:1;">
                <div style="font-size:13px;font-weight:800;color:${destaque?'var(--ouro-claro)':'var(--branco)'};">${eq.nome}${destaque?' ⭐':''}</div>
                ${ehIndividual ? '' : `<div style="font-size:11px;color:var(--texto3);">${eq.membros.length} colportor(es)</div>`}
              </div>
              <div style="font-family:var(--num-font);font-size:18px;font-weight:800;color:${i===0?'var(--amarelo)':i===1?'#C0C0C0':'#CD7F32'};">${fmtMini(eq.total)}</div>
            </div>`;
          }).join('')}
        </div>` : `<div style="font-size:12px;color:var(--texto3);text-align:center;padding:8px 0;">${ehIndividual ? 'Nenhum colportor cadastrado ainda.' : 'Aguardando configuração de equipes.'}</div>`}
      </div>`;
    }).join('');
  } catch(e) {
    container.innerHTML = `<div style="color:var(--danger);font-size:13px;">Erro ao carregar: ${e.message}</div>`;
  }
}

// ── Mostrar competição ativa no Dashboard Admin ──
async function renderSmaxDashWidget() {
  const widgetArea = document.getElementById('smax-dash-widget');
  if (!widgetArea) return;
  try {
    const snap = await getDocs(collection(db, 'competicoes'));
    const comps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const ativa = comps.find(c => smaxStatusComp(c) === 'ativa');
    if (!ativa) { widgetArea.style.display = 'none'; return; }
    widgetArea.style.display = 'block';
    const ranking = smaxRankingEquipes(ativa);
    const medalhas = ['🥇','🥈','🥉'];
    widgetArea.innerHTML = `
      <div style="background:linear-gradient(135deg,rgba(255,107,74,0.1),rgba(255,177,0,0.07));border:1px solid rgba(255,107,74,0.3);border-radius:16px;padding:18px;margin-top:16px;position:relative;overflow:hidden;">
        <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#FF6B00,#FFCE45,#FF6B00);"></div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <span style="font-size:22px;">🏅</span>
          <div>
            <div style="font-size:14px;font-weight:800;color:var(--branco);">${ativa.nome}</div>
            <div style="font-size:11px;color:var(--accent-hot);">${smaxTipoLabel(ativa.tipo)} · ${formatarData(ativa.inicio)} → ${formatarData(ativa.fim)}</div>
          </div>
        </div>
        ${ativa.premioTipo ? `
        <div style="display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,rgba(255,206,69,0.12),rgba(255,177,0,0.07));border:1px solid rgba(255,206,69,0.35);border-radius:12px;padding:10px 14px;margin-bottom:12px;">
          <span style="font-size:24px;">🏆</span>
          <div>
            <div style="font-size:10px;color:rgba(255,206,69,0.65);font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-bottom:1px;">Premiação</div>
            <div style="font-size:16px;font-weight:900;color:#FFCE45;font-family:var(--display-font);">${ativa.premioTipo}</div>
            ${ativa.premioNome ? `<div style="font-size:12px;color:var(--ouro-claro);font-weight:600;">✨ ${ativa.premioNome}</div>` : ''}
          </div>
        </div>` : ''}
        <div style="display:grid;gap:6px;">
          ${ranking.slice(0,3).map((eq, i) => `
          <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:rgba(16,26,51,0.03);border-radius:8px;">
            <span style="font-size:16px;">${medalhas[i]||'🏅'}</span>
            <div style="flex:1;font-size:13px;font-weight:700;color:var(--branco);">${eq.nome}</div>
            <div style="font-family:var(--num-font);font-size:14px;font-weight:800;color:${i===0?'var(--amarelo)':i===1?'#C0C0C0':'#CD7F32'};">${fmtMini(eq.total)}</div>
          </div>`).join('')}
        </div>
      </div>`;
  } catch(e) { console.warn('smax dash widget:', e); }
}

// ══════════════════════════════════════════════════════════════════
// FIM SEMANA MÁXIMA
// ══════════════════════════════════════════════════════════════════


// ── PREMIAÇÕES GALLERY ──
const PREMIACOES_PAGES = [
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-01.jpg?alt=media&token=cf3c173b-52af-48e9-96fa-0cd5a2ddb305",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-02.jpg?alt=media&token=d8ce96e2-ffaf-4860-84b6-ecf996a768da",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-03.jpg?alt=media&token=e658ea6e-2cf9-4f00-be01-793baf63b136",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-04.jpg?alt=media&token=73c18d06-c1fd-45d2-b385-bbf04d9a626f",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-05.jpg?alt=media&token=cac77906-fa1b-4359-a5d8-2e6046e9467e",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-06.jpg?alt=media&token=459b1985-def7-4007-a44d-ed6b2866a7ba",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-07.jpg?alt=media&token=1f0c933b-9913-4a58-a535-20f844733dbd",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-08.jpg?alt=media&token=417f92ed-2502-45ee-a65f-7894314eaadb",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-09.jpg?alt=media&token=8149e5c1-b673-4bd4-a38e-14fbdfdc2522",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-10.jpg?alt=media&token=cf982706-33a7-409e-af3f-ba8968b3f3f3",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-11.jpg?alt=media&token=374b53c5-dfac-4c8e-b348-c50b1f6e978d",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-12.jpg?alt=media&token=4258b190-9249-4d73-a6df-584b95dbc4b4",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-13.jpg?alt=media&token=c77ec571-9770-41a7-a9ed-b096c0a9ab52",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-14.jpg?alt=media&token=35239078-c6f1-474b-b607-1a7e8486c1ec",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-15.jpg?alt=media&token=ee7866c0-3b5c-4e2f-b330-0c425fb7f15b",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-16.jpg?alt=media&token=3cd4f3a3-5dac-4101-9fe3-345202895081",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-17.jpg?alt=media&token=836319f3-ff0e-455c-9cd7-f8c0a637d299",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-18.jpg?alt=media&token=ac0d3318-8b68-4b1e-80ef-c7d0fdb18611",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-19.jpg?alt=media&token=d5f8ebb6-dbbd-4bc4-b00e-71a5019bd872",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-20.jpg?alt=media&token=2c214d5d-eb5c-4b44-bdfc-12bf6c59a1f8",
  "https://firebasestorage.googleapis.com/v0/b/super-acao2026.firebasestorage.app/o/premiacoes%2Fpremiacao-21.jpg?alt=media&token=cf01247b-566a-4b70-b2a7-98e04564469b",
];


function renderPremicoesGallery(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (container._premRendered) return; // already rendered, avoid duplicate
  container._premRendered = true;

  const total = PREMIACOES_PAGES.length;
  container.innerHTML = `
    <div style="max-width:520px;margin:0 auto;">
      <div style="font-size:11px;color:var(--texto3);text-align:center;margin-bottom:12px;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;">Role para baixo para ver todos os ${total} prêmios</div>
      ${PREMIACOES_PAGES.map((src, i) => `
        <div style="margin-bottom:14px;border-radius:14px;overflow:hidden;border:1px solid rgba(255,177,0,0.18);box-shadow:0 8px 24px rgba(0,0,0,0.4);">
          <img src="${src}" alt="Premiação ${i+1}" style="width:100%;display:block;border-radius:14px;" loading="lazy">
        </div>`).join('')}
    </div>`;
}

// ══════════════════════════════════════════════════════
// AGENDA DE ASSISTÊNCIA
// ══════════════════════════════════════════════════════

let AGENDA_INICIO  = '2026-06-01'; // atualizado dinamicamente com a dataInicio da campanha ativa
let AGENDA_FIM     = '2026-08-25'; // atualizado dinamicamente com a dataFim da campanha ativa
const SEMANAS_PT     = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
// Gera todos os dias úteis (seg-sáb) entre AGENDA_INICIO e AGENDA_FIM
function agendaGerarDias() {
  const dias = [];
  let cur = new Date(AGENDA_INICIO + 'T12:00:00');
  const fim = new Date(AGENDA_FIM + 'T12:00:00');
  while (cur <= fim) {
    const dow = cur.getDay(); // 0=dom
    if (dow !== 0) { // exclui domingos
      const iso = cur.toISOString().split('T')[0];
      dias.push(iso);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return dias;
}

function agendaFormatarDia(iso) {
  const d = new Date(iso + 'T12:00:00');
  return `${SEMANAS_PT[d.getDay()]}, ${d.getDate()} ${MESES_PT[d.getMonth()]}`;
}

function agendaDiaSemanaCompleto(iso) {
  const d = new Date(iso + 'T12:00:00');
  const nomes = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  return nomes[d.getDay()];
}

// ── CACHE DA AGENDA POR LÍDER ──
let agendaCache = {}; // { liderId: { 'YYYY-MM-DD': { colportor, obs } } }

async function agendaCarregarLider(liderId) {
  try {
    const snap = await getDocs(query(collection(db,'agenda_assistencia'), where('liderId','==',liderId)));
    const mapa = {};
    snap.docs.forEach(d => { const data = d.data(); mapa[data.data] = { id: d.id, colportor: data.colportor, obs: data.obs||'' }; });
    agendaCache[liderId] = mapa;
    return mapa;
  } catch(e) { console.warn('agendaCarregarLider:', e); return {}; }
}

// ── FILTRO ATIVO DA AGENDA DO LÍDER (todos / pendentes) ──
let agendaFiltroLider = 'todos';

// ── RENDER AGENDA DO LÍDER ──
async function renderAgendaLider() {
  if (!currentLider) return;
  const container = document.getElementById('l-agenda-container');
  const resumoEl  = document.getElementById('l-agenda-resumo');
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--texto3);font-size:13px;">Carregando agenda...</div>';

  const mapa = await agendaCarregarLider(currentLider.id);
  const todos = agendaGerarDias();
  const hoje  = getHoje();

  const preenchidos  = todos.filter(d => mapa[d]);
  const pendentes    = todos.filter(d => !mapa[d] && d >= hoje);
  const passadosSemPreencher = todos.filter(d => !mapa[d] && d < hoje);

  if (resumoEl) {
    resumoEl.textContent = `${preenchidos.length}/${todos.length} preenchidos · ${pendentes.length} pendentes`;
  }

  const dias = agendaFiltroLider === 'pendentes'
    ? [...passadosSemPreencher, ...pendentes]
    : todos;

  if (!dias.length) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--texto3);font-size:13px;">Nenhum dia pendente! 🎉</div>';
    return;
  }

  // Agrupar por mês
  const grupos = {};
  dias.forEach(iso => {
    const mes = iso.slice(0,7);
    if (!grupos[mes]) grupos[mes] = [];
    grupos[mes].push(iso);
  });

  container.innerHTML = Object.entries(grupos).map(([mes, diasMes]) => {
    const [y, m] = mes.split('-');
    const mesLabel = `${MESES_PT[parseInt(m)-1]} ${y}`;
    const rows = diasMes.map(iso => agendaRenderDiaLider(iso, mapa, hoje)).join('');
    return `
      <div style="margin-bottom:8px;">
        <div style="font-size:10px;font-weight:800;color:var(--ouro);text-transform:uppercase;letter-spacing:2px;padding:6px 10px;background:rgba(255,177,0,0.07);border-radius:8px;margin-bottom:4px;">${mesLabel}</div>
        ${rows}
      </div>`;
  }).join('');

  // bind clicks
  container.querySelectorAll('[data-agenda-dia]').forEach(el => {
    el.addEventListener('click', function() {
      abrirModalAgendaDia(this.getAttribute('data-agenda-dia'), mapa);
    });
  });
}

function agendaRenderDiaLider(iso, mapa, hoje) {
  const entrada = mapa[iso];
  const isFuturo = iso >= hoje;
  const isHoje = iso === hoje;
  const preenchido = !!entrada;

  let bgColor, borderColor, badgeHtml, infoHtml;

  if (isHoje) {
    bgColor = preenchido ? 'rgba(255,177,0,0.12)' : 'rgba(255,107,74,0.10)';
    borderColor = preenchido ? 'rgba(255,177,0,0.4)' : 'rgba(255,107,74,0.45)';
  } else if (isFuturo) {
    bgColor = preenchido ? 'rgba(0,200,80,0.06)' : 'rgba(16,26,51,0.03)';
    borderColor = preenchido ? 'rgba(0,200,80,0.25)' : 'rgba(16,26,51,0.08)';
  } else {
    bgColor = preenchido ? 'rgba(255,177,0,0.06)' : 'rgba(239,83,80,0.05)';
    borderColor = preenchido ? 'rgba(255,177,0,0.2)' : 'rgba(239,83,80,0.2)';
  }

  if (preenchido) {
    badgeHtml = `<span style="background:rgba(0,200,80,0.15);border:1px solid rgba(0,200,80,0.3);border-radius:100px;padding:2px 8px;font-size:10px;font-weight:800;color:#00C850;">✓ Definido</span>`;
    infoHtml  = `<div style="font-size:13px;font-weight:700;color:var(--branco);">👤 ${escapeHtml(entrada.colportor)}</div>${entrada.obs ? `<div style="font-size:11px;color:var(--texto3);margin-top:1px;">📝 ${escapeHtml(entrada.obs)}</div>` : ''}`;
  } else if (!isFuturo) {
    badgeHtml = `<span style="background:rgba(239,83,80,0.12);border:1px solid rgba(239,83,80,0.3);border-radius:100px;padding:2px 8px;font-size:10px;font-weight:800;color:#EF5350;">Não preenchido</span>`;
    infoHtml  = `<div style="font-size:12px;color:var(--texto3);">Dia passado sem definição.</div>`;
  } else {
    badgeHtml = `<span style="background:rgba(255,206,69,0.1);border:1px solid rgba(255,206,69,0.25);border-radius:100px;padding:2px 8px;font-size:10px;font-weight:800;color:#FFCE45;">⏳ Pendente</span>`;
    infoHtml  = `<div style="font-size:12px;color:var(--texto3);">Clique para preencher</div>`;
  }

  const hojeTag = isHoje ? `<span style="background:rgba(255,107,74,0.2);border:1px solid rgba(255,107,74,0.4);border-radius:6px;padding:1px 6px;font-size:9px;font-weight:800;color:#FF8C42;margin-left:6px;">HOJE</span>` : '';

  return `
  <div data-agenda-dia="${iso}" style="display:flex;align-items:center;gap:12px;background:${bgColor};border:1px solid ${borderColor};border-radius:10px;padding:10px 14px;cursor:pointer;transition:all 0.15s;" onmouseover="this.style.borderColor='rgba(255,177,0,0.4)'" onmouseout="this.style.borderColor='${borderColor}'">
    <div style="min-width:52px;text-align:center;">
      <div style="font-size:10px;font-weight:700;color:var(--texto3);text-transform:uppercase;letter-spacing:1px;">${agendaFormatarDia(iso).split(',')[0]}</div>
      <div style="font-size:18px;font-weight:900;font-family:var(--num-font);color:${isHoje ? 'var(--accent-hot)' : 'var(--texto)'};">${new Date(iso+'T12:00:00').getDate()}</div>
    </div>
    <div style="width:1px;height:36px;background:rgba(16,26,51,0.08);"></div>
    <div style="flex:1;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
        <span style="font-size:12px;font-weight:700;color:var(--texto2);">${agendaFormatarDia(iso).split(', ')[1] || agendaFormatarDia(iso)}</span>
        ${hojeTag}
      </div>
      ${infoHtml}
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
      ${badgeHtml}
      <span style="font-size:10px;color:var(--texto3);">✏️ editar</span>
    </div>
  </div>`;
}

// ── MODAL AGENDA DIA ──
let magDiaAtual = null;
let magMapaAtual = null;

function abrirModalAgendaDia(iso, mapa) {
  magDiaAtual = iso;
  magMapaAtual = mapa;
  const entrada = mapa[iso];
  const d = new Date(iso + 'T12:00:00');

  document.getElementById('mag-titulo').textContent = agendaDiaSemanaCompleto(iso) + ', ' + d.getDate() + ' de ' + MESES_PT[d.getMonth()];
  document.getElementById('mag-subtitulo').textContent = iso === getHoje() ? '📍 Hoje' : (iso < getHoje() ? '📆 Dia já passou' : '📆 Dia futuro');
  document.getElementById('mag-colportor').value = entrada ? entrada.colportor : '';
  document.getElementById('mag-obs').value        = entrada ? entrada.obs : '';
  document.getElementById('mag-msg').style.display = 'none';

  // sugestoes de colportores - addEventListener pois script module bloqueia onclick inline
  const colportores = liveUsuarios.filter(u => u.tipo !== 'admin' && u.tipo !== 'lider').map(u => u.nome);
  const sugEl = document.getElementById('mag-sugestoes');
  const inputCol = document.getElementById('mag-colportor');

  function realcarSugestao(btnSel) {
    sugEl.querySelectorAll('[data-sug-idx]').forEach(b => {
      b.style.background = 'rgba(255,177,0,0.06)';
      b.style.borderColor = 'rgba(255,177,0,0.2)';
      b.style.color = 'var(--texto2)';
    });
    if (btnSel) {
      btnSel.style.background = 'linear-gradient(135deg,rgba(255,177,0,0.28),rgba(180,83,9,0.18))';
      btnSel.style.borderColor = 'rgba(255,177,0,0.7)';
      btnSel.style.color = 'var(--ouro-claro)';
    }
  }

  sugEl.innerHTML = colportores.map((n, i) => [
    '<button type="button" data-sug-idx="' + i + '"',
    ' style="padding:5px 10px;border-radius:100px;border:1px solid rgba(255,177,0,0.2);',
    'background:rgba(255,177,0,0.06);color:var(--texto2);font-family:var(--body-font);',
    'font-size:11px;font-weight:600;cursor:pointer;transition:all 0.15s;">',
    '👤 ' + n + '</button>'
  ].join('')).join('');

  sugEl.querySelectorAll('[data-sug-idx]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-sug-idx'));
      inputCol.value = colportores[idx];
      realcarSugestao(btn);
    });
  });

  if (inputCol.value) {
    const selBtn = [...sugEl.querySelectorAll('[data-sug-idx]')].find(
      b => colportores[parseInt(b.getAttribute('data-sug-idx'))] === inputCol.value
    );
    if (selBtn) realcarSugestao(selBtn);
  }

  const modal = document.getElementById('modal-agenda-dia');
  modal.style.display = 'flex';
  setTimeout(() => inputCol.focus(), 80);
}

document.getElementById('mag-btn-fechar').onclick = () => { document.getElementById('modal-agenda-dia').style.display = 'none'; };
document.getElementById('modal-agenda-dia').onclick = function(e) { if (e.target === this) this.style.display = 'none'; };

document.getElementById('mag-btn-salvar').onclick = async () => {
  const nomeDigitado = document.getElementById('mag-colportor').value.trim();
  const obs       = document.getElementById('mag-obs').value.trim();
  const msgEl     = document.getElementById('mag-msg');
  if (!nomeDigitado) { msgEl.textContent = '⚠️ Informe o nome do colportor.'; msgEl.style.color = 'var(--danger)'; msgEl.style.display = 'block'; return; }
  const match = liveUsuarios.find(u => u.tipo !== 'admin' && u.tipo !== 'lider' && u.nome.trim().toLowerCase() === nomeDigitado.toLowerCase());
  if (!match) { msgEl.textContent = '⚠️ Selecione um colportor da lista de sugestões (o nome precisa corresponder a um cadastro existente).'; msgEl.style.color = 'var(--danger)'; msgEl.style.display = 'block'; return; }
  if (!currentLider) return;
  try {
    showSyncStatus('💾 Salvando...', 'saving');
    const docId = `agenda_${currentLider.id}_${magDiaAtual}`;
    await setDoc(doc(db, 'agenda_assistencia', docId), {
      liderId: currentLider.id, liderNome: currentLider.nome, campanhaId: currentLider.campanhaId,
      data: magDiaAtual, colportor: match.nome, colportorId: match.id, obs, atualizadoEm: getHoje()
    });
    showSyncStatus('✅ Salvo!', 'saved');
    msgEl.textContent = '✅ Salvo!'; msgEl.style.color = 'var(--ouro-claro)'; msgEl.style.display = 'block';
    document.getElementById('modal-agenda-dia').style.display = 'none';
    await renderAgendaLider();
  } catch(e) { msgEl.textContent = '❌ Erro: ' + e.message; msgEl.style.color = 'var(--danger)'; msgEl.style.display = 'block'; showSyncStatus('❌ Erro', 'error'); }
};

document.getElementById('mag-btn-limpar').onclick = () => {
  mostrarConfirm('Limpar este dia?', 'O preenchimento deste dia será removido da agenda.', async () => {
    if (!currentLider || !magDiaAtual) return;
    try {
      showSyncStatus('🗑️ Removendo...', 'saving');
      const docId = `agenda_${currentLider.id}_${magDiaAtual}`;
      await deleteDoc(doc(db, 'agenda_assistencia', docId));
      showSyncStatus('✅ Removido!', 'saved');
      document.getElementById('modal-agenda-dia').style.display = 'none';
      mostrarToast('Dia removido da agenda.');
      await renderAgendaLider();
    } catch(e) { mostrarToast('Erro ao remover: ' + e.message, true); showSyncStatus('❌ Erro', 'error'); }
  });
};

// Filtros da agenda
document.getElementById('btn-l-agenda-todos').addEventListener('click', () => {
  agendaFiltroLider = 'todos';
  document.getElementById('btn-l-agenda-todos').style.background = 'linear-gradient(135deg,#FFB100,#B45309)';
  document.getElementById('btn-l-agenda-todos').style.color = '#000';
  document.getElementById('btn-l-agenda-pendentes').style.background = 'rgba(255,107,74,0.08)';
  document.getElementById('btn-l-agenda-pendentes').style.color = '#FF8C42';
  renderAgendaLider();
});
document.getElementById('btn-l-agenda-pendentes').addEventListener('click', () => {
  agendaFiltroLider = 'pendentes';
  document.getElementById('btn-l-agenda-pendentes').style.background = 'linear-gradient(135deg,#FF6B00,#FF4500)';
  document.getElementById('btn-l-agenda-pendentes').style.color = '#fff';
  document.getElementById('btn-l-agenda-todos').style.background = 'rgba(255,177,0,0.07)';
  document.getElementById('btn-l-agenda-todos').style.color = 'var(--ouro-claro)';
  renderAgendaLider();
});

// ── AGENDA DO LÍDER — CHAMAR APÓS LOGIN ──
// (chamado em renderLiderPainel)

// ── ADMIN: AGENDA DOS LÍDERES ──
let admAgendaLiderSel = null;

async function renderAdmAgenda() {
  const selector  = document.getElementById('adm-agenda-selector');
  const container = document.getElementById('adm-agenda-container');
  const vazioEl   = document.getElementById('adm-agenda-vazio');
  if (!selector || !container) return;

  try {
    const snap = campanhaVisualizada
      ? await getDocs(query(collection(db,'lideres'), where('campanhaId','==',campanhaVisualizada)))
      : await getDocs(collection(db, 'lideres'));
    const lideres = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (!lideres.length) {
      selector.innerHTML = '';
      container.innerHTML = '';
      if (vazioEl) vazioEl.style.display = 'block';
      return;
    }
    if (vazioEl) vazioEl.style.display = 'none';

    if (!admAgendaLiderSel || !lideres.find(l => l.id === admAgendaLiderSel)) {
      admAgendaLiderSel = lideres[0].id;
    }

    selector.innerHTML = lideres.map((l, i) => {
      const sel = l.id === admAgendaLiderSel;
      return `<button data-adm-agenda-lider="${l.id}" style="padding:8px 18px;border-radius:100px;border:1px solid ${sel ? 'var(--ouro)' : 'rgba(255,177,0,0.2)'};background:${sel ? 'linear-gradient(135deg,#FFB100,#B45309)' : 'transparent'};color:${sel ? '#000' : 'var(--texto3)'};font-family:var(--body-font);font-size:12px;font-weight:700;cursor:pointer;transition:all 0.15s;">👑 ${escapeHtml(l.nome)}</button>`;
    }).join('');

    selector.querySelectorAll('[data-adm-agenda-lider]').forEach(btn => {
      btn.addEventListener('click', async function() {
        admAgendaLiderSel = this.getAttribute('data-adm-agenda-lider');
        await renderAdmAgenda();
      });
    });

    const lider = lideres.find(l => l.id === admAgendaLiderSel);
    await renderAdmAgendaContainer(lider, container);

  } catch(e) { container.innerHTML = `<div style="color:var(--danger);font-size:13px;">Erro: ${e.message}</div>`; }
}

async function renderAdmAgendaContainer(lider, container) {
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--texto3);font-size:13px;">Carregando agenda de ' + lider.nome.split(' ')[0] + '...</div>';
  const mapa = await agendaCarregarLider(lider.id);
  const todos = agendaGerarDias();
  const hoje  = getHoje();

  const preenchidos = todos.filter(d => mapa[d]).length;
  const pendentes   = todos.filter(d => !mapa[d] && d >= hoje).length;

  const grupos = {};
  todos.forEach(iso => {
    const mes = iso.slice(0,7);
    if (!grupos[mes]) grupos[mes] = [];
    grupos[mes].push(iso);
  });

  container.innerHTML = `
    <div style="display:flex;gap:16px;margin-bottom:14px;flex-wrap:wrap;">
      <div style="background:rgba(0,200,80,0.08);border:1px solid rgba(0,200,80,0.2);border-radius:10px;padding:10px 16px;text-align:center;">
        <div style="font-size:10px;color:var(--texto3);font-weight:700;text-transform:uppercase;letter-spacing:1px;">Preenchidos</div>
        <div style="font-size:22px;font-weight:900;font-family:var(--num-font);color:#00C850;">${preenchidos}</div>
      </div>
      <div style="background:rgba(255,206,69,0.08);border:1px solid rgba(255,206,69,0.2);border-radius:10px;padding:10px 16px;text-align:center;">
        <div style="font-size:10px;color:var(--texto3);font-weight:700;text-transform:uppercase;letter-spacing:1px;">Pendentes</div>
        <div style="font-size:22px;font-weight:900;font-family:var(--num-font);color:#FFCE45;">${pendentes}</div>
      </div>
      <div style="background:rgba(255,177,0,0.06);border:1px solid rgba(255,177,0,0.15);border-radius:10px;padding:10px 16px;text-align:center;">
        <div style="font-size:10px;color:var(--texto3);font-weight:700;text-transform:uppercase;letter-spacing:1px;">Total de dias</div>
        <div style="font-size:22px;font-weight:900;font-family:var(--num-font);color:var(--ouro-claro);">${todos.length}</div>
      </div>
    </div>
    ${Object.entries(grupos).map(([mes, diasMes]) => {
      const [y, m] = mes.split('-');
      const mesLabel = `${MESES_PT[parseInt(m)-1]} ${y}`;
      const rows = diasMes.map(iso => {
        const entrada = mapa[iso];
        const isFuturo = iso >= hoje;
        const isHoje = iso === hoje;
        let bg, border, badge, info;
        if (entrada) {
          bg = 'rgba(0,200,80,0.05)'; border = 'rgba(0,200,80,0.2)';
          badge = `<span style="background:rgba(0,200,80,0.15);border:1px solid rgba(0,200,80,0.3);border-radius:100px;padding:2px 8px;font-size:10px;font-weight:800;color:#00C850;">✓ Definido</span>`;
          info = `<div style="font-size:13px;font-weight:700;color:var(--branco);">👤 ${escapeHtml(entrada.colportor)}</div>${entrada.obs ? `<div style="font-size:11px;color:var(--texto3);">📝 ${escapeHtml(entrada.obs)}</div>` : ''}`;
        } else if (!isFuturo) {
          bg = 'rgba(239,83,80,0.04)'; border = 'rgba(239,83,80,0.15)';
          badge = `<span style="background:rgba(239,83,80,0.1);border:1px solid rgba(239,83,80,0.25);border-radius:100px;padding:2px 8px;font-size:10px;font-weight:800;color:#EF5350;">Não preenchido</span>`;
          info = `<div style="font-size:11px;color:var(--texto3);">Líder não preencheu este dia.</div>`;
        } else {
          bg = 'rgba(16,26,51,0.02)'; border = 'rgba(16,26,51,0.07)';
          badge = `<span style="background:rgba(255,206,69,0.08);border:1px solid rgba(255,206,69,0.2);border-radius:100px;padding:2px 8px;font-size:10px;font-weight:800;color:#FFCE45;">⏳ Pendente</span>`;
          info = `<div style="font-size:11px;color:var(--texto3);">Aguardando preenchimento.</div>`;
        }
        const hojeTag = isHoje ? `<span style="background:rgba(255,107,74,0.2);border:1px solid rgba(255,107,74,0.4);border-radius:6px;padding:1px 6px;font-size:9px;font-weight:800;color:#FF8C42;margin-left:5px;">HOJE</span>` : '';
        return `
        <div style="display:flex;align-items:center;gap:12px;background:${bg};border:1px solid ${border};border-radius:10px;padding:10px 14px;margin-bottom:4px;">
          <div style="min-width:48px;text-align:center;">
            <div style="font-size:10px;font-weight:700;color:var(--texto3);text-transform:uppercase;">${agendaFormatarDia(iso).split(',')[0]}</div>
            <div style="font-size:17px;font-weight:900;font-family:var(--num-font);color:${isHoje?'var(--accent-hot)':'var(--texto)'};">${new Date(iso+'T12:00:00').getDate()}</div>
          </div>
          <div style="width:1px;height:32px;background:rgba(16,26,51,0.07);"></div>
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;"><span style="font-size:12px;font-weight:600;color:var(--texto2);">${agendaFormatarDia(iso).split(', ')[1]||agendaFormatarDia(iso)}</span>${hojeTag}</div>
            ${info}
          </div>
          <div>${badge}</div>
        </div>`;
      }).join('');
      return `<div style="margin-bottom:10px;"><div style="font-size:10px;font-weight:800;color:var(--ouro);text-transform:uppercase;letter-spacing:2px;padding:5px 10px;background:rgba(255,177,0,0.07);border-radius:8px;margin-bottom:4px;">${mesLabel}</div>${rows}</div>`;
    }).join('')}
  `;
}

// ── INIT ──
// Senhas ficam mascaradas por padrão nas listas do admin; clique para revelar/ocultar (evita exposição em prints/telas compartilhadas).
document.addEventListener('click', function(e){
  const el = e.target.closest('.senha-mascarada');
  if (!el) return;
  const senha = el.getAttribute('data-senha') || '';
  el.textContent = el.textContent === '••••' ? senha : '••••';
});
bindTodasMascaras();
document.getElementById('diario-data-filtro').value = getHoje();
