
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
// Logo oficial aplicada a todo elemento com classe .logo-login-img ou .logo-navbar-img
const LOGO_URL = "assets/logo.png";
document.querySelectorAll('.logo-login-img, .logo-navbar-img').forEach(img => img.src = LOGO_URL);

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
