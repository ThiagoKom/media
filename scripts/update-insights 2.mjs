// Busca os dados do Instagram (Graph API) e grava data.json na raiz do repositório.
import { writeFileSync, readFileSync, existsSync } from 'fs';
const TOKEN = process.env.IG_TOKEN;
let ID = process.env.IG_USER_ID; // opcional: se faltar, descobre sozinho pelo token da Página
const G = 'https://graph.facebook.com/v24.0';
const norm = s => s.normalize('NFD').split('').filter(c => c.charCodeAt(0) < 768 || c.charCodeAt(0) > 879).join('').toLowerCase().trim();

const get = async p => {
  const r = await fetch(G + '/' + p + (p.includes('?') ? '&' : '?') + 'access_token=' + TOKEN);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j;
};
const breakdown = async b => {
  const j = await get(ID + '/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=' + b);
  return (j.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? []).map(r => ({ k: r.dimension_values[0], v: r.value }));
};

const UF = Object.fromEntries(Object.entries({
  AC:'Acre',AL:'Alagoas',AP:'Amapa',AM:'Amazonas',BA:'Bahia',CE:'Ceara',DF:'Distrito Federal',ES:'Espirito Santo',GO:'Goias',
  MA:'Maranhao',MT:'Mato Grosso',MS:'Mato Grosso do Sul',MG:'Minas Gerais',PA:'Para',PB:'Paraiba',PR:'Parana',PE:'Pernambuco',
  PI:'Piaui',RJ:'Rio de Janeiro',RN:'Rio Grande do Norte',RS:'Rio Grande do Sul',RO:'Rondonia',RR:'Roraima',SC:'Santa Catarina',
  SP:'Sao Paulo',SE:'Sergipe',TO:'Tocantins'}).map(([a, n]) => [norm(n), a]));

// Coordenadas [lon, lat] para posicionar os círculos no mapa (cidades não listadas entram nas barras e na cor do estado, sem círculo).
const CO = {
  'sao paulo':[-46.63,-23.55],'guarulhos':[-46.53,-23.46],'campinas':[-47.06,-22.91],'santo andre':[-46.54,-23.66],'osasco':[-46.79,-23.53],
  'sao bernardo do campo':[-46.56,-23.69],'santos':[-46.33,-23.96],'sorocaba':[-47.45,-23.5],'ribeirao preto':[-47.81,-21.18],
  'rio de janeiro':[-43.17,-22.91],'niteroi':[-43.1,-22.88],'belo horizonte':[-43.94,-19.92],'uberlandia':[-48.28,-18.92],
  'contagem':[-44.05,-19.93],'vitoria':[-40.34,-20.32],'curitiba':[-49.27,-25.43],'londrina':[-51.16,-23.31],
  'florianopolis':[-48.55,-27.6],'joinville':[-48.84,-26.3],'porto alegre':[-51.23,-30.03],'brasilia':[-47.93,-15.78],
  'goiania':[-49.25,-16.68],'salvador':[-38.51,-12.97],'recife':[-34.88,-8.05],'fortaleza':[-38.52,-3.73],'natal':[-35.21,-5.79],
  'joao pessoa':[-34.86,-7.12],'maceio':[-35.74,-9.67],'aracaju':[-37.07,-10.91],'sao luis':[-44.3,-2.53],'teresina':[-42.8,-5.09],
  'belem':[-48.5,-1.46],'manaus':[-60.02,-3.12],'cuiaba':[-56.1,-15.6],'campo grande':[-54.65,-20.46],'palmas':[-48.33,-10.18],
  'porto velho':[-63.9,-8.76],'rio branco':[-67.81,-9.97],'macapa':[-51.07,0.03],'boa vista':[-60.67,2.82],
};

ID ||= (await get('me?fields=instagram_business_account')).instagram_business_account?.id;
if (!ID) throw new Error('Não achei a conta do Instagram ligada a essa Página.');

const followers = (await get(ID + '?fields=followers_count')).followers_count;
const [gen, age, city] = await Promise.all([breakdown('gender'), breakdown('age'), breakdown('city')]);

const gv = k => gen.find(g => g.k === k)?.v ?? 0;
const ageTotal = age.reduce((s, a) => s + a.v, 0) || 1;
const round = n => Math.round(n * 10) / 10;


// ---- Reels: melhor Reel, múltiplo sobre seguidores, interação e salvamentos/compartilhamentos ----
let reels = null;
try {
  const media = (await get(ID + '/media?fields=id,media_product_type,timestamp&limit=50')).data ?? [];
  const items = media.filter(m => m.media_product_type === 'REELS').slice(0, 30);
  const sets = ['views,reach,saved,shares,total_interactions', 'plays,reach,saved,shares,total_interactions'];
  const num = d => d.values?.[0]?.value ?? d.total_value?.value ?? 0;
  const rows = [];
  for (const m of items) {
    for (const set of sets) {
      try {
        const j = await get(m.id + '/insights?metric=' + set);
        const o = Object.fromEntries((j.data ?? []).map(d => [d.name, num(d)]));
        rows.push({ views: o.views ?? o.plays ?? 0, reach: o.reach ?? 0, saved: o.saved ?? 0, shares: o.shares ?? 0, inter: o.total_interactions ?? 0 });
        break;
      } catch (e) { /* tenta o próximo conjunto de métricas */ }
    }
  }
  if (rows.length) {
    const byViews = [...rows].sort((a, b) => b.views - a.views);
    const top5 = byViews.slice(0, 5);
    const topViews = top5.reduce((s, r) => s + r.views, 0) || 1;
    const top2 = [...rows].sort((a, b) => b.reach - a.reach).slice(0, 2);
    reels = {
      best: byViews[0].views,
      multiple: Math.max(1, Math.round(byViews[0].views / followers)),
      interaction: round(top5.reduce((s, r) => s + r.inter, 0) / topViews * 100),
      saves: top2.reduce((s, r) => s + r.saved, 0),
      shares: top2.reduce((s, r) => s + r.shares, 0),
      count: rows.length,
    };
  }
} catch (e) {
  console.log('Aviso: não consegui ler os Reels:', e.message);
}
// se falhar, mantém os últimos números de Reels já salvos
if (!reels && existsSync('data.json')) {
  try { reels = JSON.parse(readFileSync('data.json', 'utf-8')).reels ?? null; } catch (e) { /* segue sem Reels */ }
}

const cities = city.map(c => {
  const [name, ...rest] = c.k.split(',');
  const nm = name.trim();
  const state = norm(rest.join(',').split('(')[0]);
  const [lon, lat] = CO[norm(nm)] ?? [null, null];
  return { name: nm, uf: UF[state] ?? null, pct: round(c.v / followers * 100), lon, lat };
}).sort((a, b) => b.pct - a.pct);

writeFileSync('data.json', JSON.stringify({
  updated: new Date().toISOString(),
  followers,
  reels,
  gender: { f: gv('F'), m: gv('M') },
  age: Object.fromEntries(age.map(a => [a.k, round(a.v / ageTotal * 100)])),
  cities,
}, null, 1));
console.log('ok', followers, cities.length);
