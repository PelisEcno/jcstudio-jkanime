import axios from "axios";
import cheerio from "cheerio";
import pLimit from "p-limit";

const TOTAL_PAGES = 146; // puedes ajustar
const CONCURRENCY = 5;
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

// --- Herramientas auxiliares ---
function extractValue($, label) {
  try {
    const li = $(`li:has(b:contains("${label}")), li:has(strong:contains("${label}")), li:contains("${label}")`).first();
    if (!li || li.length === 0) return "";

    const bold = li.children("b, strong").first();
    let value = "";

    if (bold && bold.length) {
      const next = bold[0].nextSibling;
      if (next) {
        value = next.type === "text" ? (next.nodeValue || "") : $(next).text() || "";
      }
      if (!value || !value.trim()) value = bold.next().text() || "";
    } else {
      value = li.text() || "";
      const re = new RegExp(label, "i");
      value = value.replace(re, "");
    }

    value = String(value)
      .replace(/[:\u00A0]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const labelRe = new RegExp(label, "ig");
    value = value.replace(labelRe, "").replace(/\s+/g, " ").trim();

    return value;
  } catch (err) {
    console.error("extractValue error:", label, err.message);
    return "";
  }
}

function detectIsoDate(str) {
  if (!str) return null;
  const m = str.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return m ? m[1] : null;
}

// --- Obtiene listado desde el directorio ---
async function getAnimeList(page = 1) {
  const url = `https://jkanime.net/directorio${page > 1 ? `?p=${page}` : ""}`;
  try {
    const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 10000 });
    const match = data.match(/var animes = ({.*?});/s);
    if (!match) throw new Error("No se encontró el JSON en el HTML");
    const json = JSON.parse(match[1]);
    return json.data.map(a => ({
      external_id: a.id || null,
      title: a.title,
      slug: a.url.replace("https://jkanime.net/", "").replace(/\//g, ""),
      image: a.image || null,
      status: (a.status || "").trim() || "Desconocido"
    }));
  } catch (err) {
    console.error(`❌ Error lista página ${page}:`, err.message);
    return [];
  }
}

// --- Obtiene info detallada ---
async function getAnimeInfo(slug) {
  const url = `https://jkanime.net/${slug}/`;
  try {
    const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 12000 });
    const $ = cheerio.load(data);

    const genres = $('li:contains("Generos") a').map((_, el) => $(el).text().trim()).get();
    const genresUnique = [...new Set(genres)].filter(Boolean);

    const imageMain = $(".anime_pic img").attr("src") || null;
    const poster = imageMain || null;

    const langsRaw = extractValue($, "Idiomas");
    const langs = langsRaw ? langsRaw.split(",").map(s => s.trim()).filter(Boolean) : [];

    const estrenoRaw = extractValue($, "Estreno") || extractValue($, "Fecha de estreno") || extractValue($, "Premiere") || "";
    const isoDate = detectIsoDate(estrenoRaw);
    const airedFromEmitido = extractValue($, "Emitido") || extractValue($, "Fecha") || "";
    const aired = isoDate ? isoDate : (airedFromEmitido || "No emitido");

    return {
      synopsis: ($(".anime_info p.scroll").text() || "").replace(/\s+/g, " ").trim() || "Sin sinopsis",
      poster: poster,
      image: imageMain,
      type: extractValue($, "Tipo") || "Desconocido",
      episodes: parseInt(extractValue($, "Episodios")?.match(/\d+/)?.[0] || "0"),
      status: extractValue($, "Estado") || "Desconocido",
      genresArray: genresUnique,
      studio: extractValue($, "Studios") || extractValue($, "Estudios") || "Desconocido",
      season: extractValue($, "Temporada") || "Desconocida",
      demographic: extractValue($, "Demografia") || "No definida",
      languages: langs.length ? [...new Set(langs)].join(", ") : "No especificado",
      duration: extractValue($, "Duracion") || extractValue($, "Duración") || "Desconocida",
      aired: aired,
      quality: extractValue($, "Calidad") || "Sin definir"
    };
  } catch (err) {
    console.error(`❌ Error info ${slug}:`, err.message);
    return {};
  }
}

// --- Procesa una página ---
async function processPage(page) {
  const list = await getAnimeList(page);
  const limit = pLimit(CONCURRENCY);
  const results = [];

  await Promise.all(
    list.map(item =>
      limit(async () => {
        const info = await getAnimeInfo(item.slug);
        const full = { ...item, ...info };
        results.push(full);
        console.log(`${GREEN}✅ ${full.title}${RESET}`);
      })
    )
  );

  return results;
}

// --- Función principal: devuelve JSON agrupado ---
export async function getAllAnimes() {
  const enEmision = [];
  const finalizados = [];
  const porEstrenar = [];

  for (let p = 1; p <= TOTAL_PAGES; p++) {
    const pageResults = await processPage(p);

    for (const anime of pageResults) {
      const st = (anime.status || "").toLowerCase();
      if (st.includes("emisión")) enEmision.push(anime);
      else if (st.includes("finaliz")) finalizados.push(anime);
      else porEstrenar.push(anime);
    }
  }

  return {
    en_emision: enEmision,
    finalizados: finalizados,
    por_estrenar: porEstrenar
  };
}