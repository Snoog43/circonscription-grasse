/* Tableau de bord — Circonscription de Grasse (1er degré)
 * Site statique : toutes les données personnelles restent dans le navigateur (localStorage).
 * Seules des données publiques (annuaire des écoles, coordonnées GPS) sont échangées avec
 * des services externes, sauf l'assistant IA, qui n'envoie que le texte saisi volontairement.
 */
"use strict";

const CIRCO_CODE = "0060661L"; // Circonscription d'inspection du 1er degré de Grasse
const STORE_KEY = "ien-grasse-v1";
const API_KEY_STORE = "ien-grasse-claude-key";
const ANNUAIRE_URL = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/records";
const OSRM_URL = "https://router.project-osrm.org/trip/v1/driving/";

const COMPETENCES = [
  "Maîtriser les savoirs disciplinaires et leur didactique",
  "Utiliser un langage clair et adapté et intégrer dans son activité la maîtrise de la langue écrite et orale par les élèves",
  "Construire, mettre en œuvre et animer des situations d'enseignement et d'apprentissage prenant en compte la diversité des élèves",
  "Organiser et assurer un mode de fonctionnement du groupe favorisant l'apprentissage et la socialisation des élèves",
  "Évaluer les progrès et les acquisitions des élèves",
  "Coopérer au sein d'une équipe",
  "Contribuer à l'action de la communauté éducative et coopérer avec les parents d'élèves et les partenaires de l'école",
  "Installer et maintenir un climat propice aux apprentissages",
  "Agir en éducateur responsable et selon des principes éthiques",
  "Accompagner les élèves dans leur parcours de formation",
  "S'engager dans une démarche individuelle et collective de développement professionnel",
];
const NIVEAUX = ["À consolider", "Satisfaisant", "Très satisfaisant", "Excellent"];
const TYPES_RDV = [
  "Rendez-vous de carrière — 6e échelon",
  "Rendez-vous de carrière — 8e échelon",
  "Rendez-vous de carrière — 9e échelon (hors-classe)",
  "Visite d'accompagnement",
  "Inspection / visite conseil",
  "Visite T1 / T2 (néo-titulaire)",
];
const STATUTS_RDV = ["À planifier", "Planifié", "Réalisé", "Compte rendu envoyé"];

const DEFAULT_LIENS = [
  { label: "Messagerie académique", url: "https://webmail.ac-nice.fr", icon: "✉️" },
  { label: "Portail ARENA", url: "https://extranet.ac-nice.fr", icon: "🔐" },
  { label: "Magistère", url: "https://magistere.education.fr", icon: "🎓" },
  { label: "Éduscol", url: "https://eduscol.education.fr", icon: "📚" },
  { label: "Bulletin officiel", url: "https://www.education.gouv.fr/bo", icon: "📰" },
  { label: "Calendrier scolaire", url: "https://www.education.gouv.fr/calendrier-scolaire-100148", icon: "📅" },
];

/* ---------- Stockage ---------- */
function defaultState() {
  return {
    settings: {
      nom: "",
      depart: { label: "Grasse (centre)", lat: 43.6584, lon: 6.9225 },
      bareme: 0.32,
      liens: DEFAULT_LIENS,
    },
    ecolesNotes: {},
    rdv: [],
    animations: [],
    courrier: [],
  };
}
let state = load();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { /* stockage indisponible : on part de zéro */ }
  return defaultState();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast("⚠️ Impossible d'enregistrer (stockage du navigateur bloqué)"); }
}
function getApiKey() { try { return localStorage.getItem(API_KEY_STORE) || ""; } catch (e) { return ""; } }
function setApiKey(k) { try { k ? localStorage.setItem(API_KEY_STORE, k) : localStorage.removeItem(API_KEY_STORE); } catch (e) {} }

/* ---------- Utilitaires ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const todayISO = () => new Date().toISOString().slice(0, 10);
function fmtDate(iso, opts = { weekday: "short", day: "numeric", month: "short" }) {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", opts);
}
function daysUntil(iso) {
  if (!iso) return Infinity;
  return Math.round((new Date(iso + "T12:00:00") - new Date(todayISO() + "T12:00:00")) / 86400000);
}
function dateChip(iso) {
  if (!iso) return `<div class="date-chip">—</div>`;
  const d = new Date(iso + "T12:00:00");
  return `<div class="date-chip"><b>${d.getDate()}</b>${d.toLocaleDateString("fr-FR", { month: "short" })}</div>`;
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
}
function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function downloadWord(filename, title, bodyText) {
  const html = `<html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body style="font-family:Calibri,Arial;font-size:11pt">` +
    bodyText.split("\n").map((l) => `<p style="margin:0 0 6pt">${esc(l) || "&nbsp;"}</p>`).join("") + "</body></html>";
  download(filename, "﻿" + html, "application/msword");
}
function copy(text) {
  navigator.clipboard.writeText(text).then(() => toast("Copié dans le presse-papiers"), () => toast("Copie impossible"));
}

/* ---------- Écoles (annuaire public) ---------- */
let ecoles = [];
let ecolesLoading = null;
function loadEcoles() {
  if (ecolesLoading) return ecolesLoading;
  const params = new URLSearchParams({
    where: `code_circonscription="${CIRCO_CODE}" and type_etablissement="Ecole" and etat="OUVERT"`,
    select: "identifiant_de_l_etablissement,nom_etablissement,nom_commune,adresse_1,code_postal,telephone,mail,latitude,longitude,statut_public_prive,ecole_maternelle,ecole_elementaire,ulis,appartenance_education_prioritaire",
    order_by: "nom_commune,nom_etablissement",
    limit: "100",
  });
  ecolesLoading = fetch(`${ANNUAIRE_URL}?${params}`)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((d) => {
      ecoles = d.results.map((r) => ({
        uai: r.identifiant_de_l_etablissement,
        nom: r.nom_etablissement,
        commune: r.nom_commune,
        adresse: [r.adresse_1, r.code_postal].filter(Boolean).join(", "),
        tel: r.telephone, mail: r.mail,
        lat: r.latitude, lon: r.longitude,
        prive: r.statut_public_prive === "Privé",
        niveau: r.ecole_maternelle && r.ecole_elementaire ? "Primaire" : r.ecole_maternelle ? "Maternelle" : "Élémentaire",
        ulis: !!r.ulis, rep: r.appartenance_education_prioritaire,
      }));
      try { localStorage.setItem(STORE_KEY + "-ecoles-cache", JSON.stringify(ecoles)); } catch (e) {}
      return ecoles;
    })
    .catch(() => {
      try { ecoles = JSON.parse(localStorage.getItem(STORE_KEY + "-ecoles-cache")) || []; } catch (e) { ecoles = []; }
      if (!ecoles.length) toast("Annuaire des écoles injoignable (hors ligne ?)");
      return ecoles;
    });
  return ecolesLoading;
}
const ecoleByUai = (uai) => ecoles.find((e) => e.uai === uai);
const ecoleLabel = (uai) => { const e = ecoleByUai(uai); return e ? `${e.nom} (${e.commune})` : ""; };
const ecoleNotes = (uai) => state.ecolesNotes[uai] || {};
function ecoleOptions(selected) {
  return `<option value="">— Choisir une école —</option>` +
    ecoles.map((e) => `<option value="${e.uai}" ${e.uai === selected ? "selected" : ""}>${esc(e.commune)} · ${esc(e.nom)}</option>`).join("");
}

/* ---------- Modale ---------- */
function openModal(title, html, onMount) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = html;
  $("#modal").hidden = false;
  document.body.classList.add("modal-open");
  if (onMount) onMount($("#modalBody"));
}
function closeModal() { $("#modal").hidden = true; document.body.classList.remove("modal-open"); $("#modalBody").innerHTML = ""; }
$("#modalClose").onclick = closeModal;
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });
function formData(form) {
  const o = {};
  new FormData(form).forEach((v, k) => (o[k] = typeof v === "string" ? v.trim() : v));
  return o;
}

/* ---------- Routeur ---------- */
const VIEWS = {
  accueil: { title: "Accueil", render: renderAccueil },
  courrier: { title: "Courrier", render: renderCourrier },
  rdv: { title: "Rendez-vous de carrière", render: renderRdv },
  cr: { title: "Comptes rendus", render: renderCR },
  ecoles: { title: "Écoles de la circonscription", render: renderEcoles },
  trajets: { title: "Optimisation des trajets", render: renderTrajets },
  animations: { title: "Animations pédagogiques", render: renderAnimations },
  redaction: { title: "Courriers types", render: renderRedaction },
  parametres: { title: "Réglages", render: renderParametres },
};
function route() {
  const name = (location.hash.slice(1) || "accueil").split("/")[0];
  const v = VIEWS[name] || VIEWS.accueil;
  $("#viewTitle").textContent = v.title;
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === name));
  $("#sidebar").classList.remove("open");
  if (map) { map.remove(); map = null; }
  $("#view").innerHTML = "";
  v.render($("#view"), location.hash.slice(1).split("/")[1]);
  updateCounts();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
$("#menuBtn").onclick = () => $("#sidebar").classList.toggle("open");
$("#todayLabel").textContent = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/* ========== ACCUEIL ========== */
function renderAccueil(el) {
  const today = todayISO();
  const rdvAVenir = state.rdv.filter((r) => r.date && r.date >= today && r.statut !== "Réalisé" && r.statut !== "Compte rendu envoyé")
    .sort((a, b) => (a.date + (a.heure || "")).localeCompare(b.date + (b.heure || "")));
  const crAFaire = crListe().filter((r) => crEtat(r) === "arediger");
  const animAVenir = state.animations.filter((a) => a.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const courrierOuvert = state.courrier.filter((c) => c.statut !== "Traité");
  const enRetard = courrierOuvert.filter((c) => c.echeance && c.echeance < today);
  const heures = state.animations.reduce((s, a) => s + (parseFloat(a.duree) || 0), 0);
  const prenom = state.settings.nom ? `, ${esc(state.settings.nom)}` : "";
  const h = new Date().getHours();

  el.innerHTML = `
  <div class="stack">
    <div class="page-head"><div><h2>${h < 18 ? "Bonjour" : "Bonsoir"}${prenom}</h2><p>Voici votre journée.</p></div></div>
    <div class="grid grid-4">
      <a class="card stat" href="#rdv"><div class="num">${rdvAVenir.length}</div><div class="lbl">Rendez-vous à venir</div></a>
      <a class="card stat ${crAFaire.length ? "alert" : ""}" href="#cr"><div class="num">${crAFaire.length}</div><div class="lbl">Comptes rendus à rédiger</div></a>
      <a class="card stat ${enRetard.length ? "alert" : ""}" href="#courrier"><div class="num">${courrierOuvert.length}</div><div class="lbl">Courriers à traiter${enRetard.length ? ` · <b>${enRetard.length} en retard</b>` : ""}</div></a>
      <a class="card stat" href="#animations"><div class="num">${heures}<span class="small muted"> h</span></div><div class="lbl">Animations planifiées</div></a>
    </div>

    <div class="card">
      <div class="card-head"><h2>Accès rapides</h2><a class="small" href="#parametres">Modifier</a></div>
      <div class="links">${state.settings.liens.map((l) => `<a class="link-tile" href="${esc(l.url)}" target="_blank" rel="noopener"><span class="ico">${esc(l.icon || "🔗")}</span>${esc(l.label)}</a>`).join("")}</div>
    </div>

    <div class="grid grid-3">
      <div class="card">
        <div class="card-head"><h2>Prochains rendez-vous</h2><a class="small" href="#rdv">Tout voir</a></div>
        <ul class="list">${rdvAVenir.slice(0, 6).map((r) => `
          <li>${dateChip(r.date)}<div><div><b>${esc(r.enseignant)}</b> ${r.heure ? `<span class="muted small">à ${esc(r.heure)}</span>` : ""}</div>
          <div class="small muted">${esc(ecoleLabel(r.uai) || r.ecoleLibre || "")}</div></div></li>`).join("") || `<li class="empty">Aucun rendez-vous planifié.</li>`}</ul>
      </div>
      <div class="card">
        <div class="card-head"><h2>Courrier à traiter</h2><a class="small" href="#courrier">Tout voir</a></div>
        <ul class="list">${courrierOuvert.sort((a, b) => (a.echeance || "9").localeCompare(b.echeance || "9")).slice(0, 6).map((c) => `
          <li>${dateChip(c.echeance)}<div><div><b>${esc(c.objet)}</b></div><div class="small muted">${esc(c.expediteur || "")} ${c.echeance && c.echeance < today ? '<span class="badge danger">en retard</span>' : ""}</div></div></li>`).join("") || `<li class="empty">Rien en attente 🎉</li>`}</ul>
      </div>
      <div class="card">
        <div class="card-head"><h2>Animations à venir</h2><a class="small" href="#animations">Tout voir</a></div>
        <ul class="list">${animAVenir.slice(0, 6).map((a) => `
          <li>${dateChip(a.date)}<div><div><b>${esc(a.titre)}</b></div><div class="small muted">${esc(a.lieu || "")} · ${esc(a.duree || "?")} h · ${(a.participants || []).length} inscrits</div></div></li>`).join("") || `<li class="empty">Aucune animation planifiée.</li>`}</ul>
      </div>
    </div>
  </div>`;
}

/* ========== MESSAGERIE & COURRIER ========== */
function renderCourrier(el) {
  const today = todayISO();
  const filtre = renderCourrier.filtre || "ouvert";
  const items = state.courrier
    .filter((c) => filtre === "tous" || (filtre === "ouvert" ? c.statut !== "Traité" : c.statut === "Traité"))
    .sort((a, b) => (a.echeance || "9999").localeCompare(b.echeance || "9999"));
  const webmail = state.settings.liens.find((l) => /mail/i.test(l.label)) || DEFAULT_LIENS[0];

  el.innerHTML = `
  <div class="stack">
    <div class="card">
      <div class="row">
        <div style="flex:1;min-width:240px">
          <h2>Messagerie académique</h2>
          <p class="muted small" style="margin:6px 0 0">Pour des raisons de sécurité, la boîte mail académique ne peut pas être lue depuis ce site.
          Ouvrez-la avec le bouton ci-contre, et notez ici les mails qui demandent une action, avec leur échéance : ils remontent sur l'accueil.</p>
        </div>
        <a class="btn primary big" href="${esc(webmail.url)}" target="_blank" rel="noopener">${icon("mail")}Ouvrir la messagerie</a>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Courriers et demandes à traiter</h2>
        <div class="row">
          <select id="cFiltre" style="width:auto">
            <option value="ouvert" ${filtre === "ouvert" ? "selected" : ""}>À traiter</option>
            <option value="traite" ${filtre === "traite" ? "selected" : ""}>Traités</option>
            <option value="tous" ${filtre === "tous" ? "selected" : ""}>Tous</option>
          </select>
          <button class="btn primary" id="cAdd">${icon("plus")}Ajouter</button>
        </div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th></th><th>Objet</th><th>Expéditeur</th><th>Reçu</th><th>Échéance</th><th>Priorité</th><th></th></tr></thead>
        <tbody>${items.map((c) => `
          <tr class="clickable" data-id="${c.id}">
            <td><input type="checkbox" data-done="${c.id}" ${c.statut === "Traité" ? "checked" : ""} title="Marquer comme traité"></td>
            <td><b>${esc(c.objet)}</b>${c.note ? `<div class="small muted">${esc(c.note.slice(0, 90))}</div>` : ""}</td>
            <td>${esc(c.expediteur)}</td>
            <td class="small">${fmtDate(c.recu)}</td>
            <td class="small">${fmtDate(c.echeance)} ${c.statut !== "Traité" && c.echeance && c.echeance < today ? '<span class="badge danger">retard</span>' : c.statut !== "Traité" && daysUntil(c.echeance) <= 3 ? '<span class="badge warn">bientôt</span>' : ""}</td>
            <td><span class="badge ${c.priorite === "Haute" ? "danger" : c.priorite === "Basse" ? "" : "info"}">${esc(c.priorite || "Normale")}</span></td>
            <td><button class="btn sm" data-edit="${c.id}">Modifier</button></td>
          </tr>`).join("") || `<tr><td colspan="7" class="empty">Aucun élément.</td></tr>`}</tbody>
      </table></div>
    </div>
  </div>`;

  $("#cFiltre").onchange = (e) => { renderCourrier.filtre = e.target.value; route(); };
  $("#cAdd").onclick = () => editCourrier();
  $$("[data-edit]", el).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); editCourrier(b.dataset.edit); }));
  $$("[data-done]", el).forEach((cb) => {
    cb.onclick = (e) => e.stopPropagation();
    cb.onchange = () => {
      const c = state.courrier.find((x) => x.id === cb.dataset.done);
      c.statut = cb.checked ? "Traité" : "À traiter"; save(); route();
    };
  });
}
function editCourrier(id) {
  const c = id ? state.courrier.find((x) => x.id === id) : { recu: todayISO(), priorite: "Normale", statut: "À traiter" };
  openModal(id ? "Modifier le courrier" : "Nouveau courrier à traiter", `
    <form id="f" class="form-grid">
      <div class="full"><label>Objet *</label><input name="objet" required value="${esc(c.objet)}"></div>
      <div><label>Expéditeur</label><input name="expediteur" value="${esc(c.expediteur)}" placeholder="DSDEN, directeur, mairie…"></div>
      <div><label>Priorité</label><select name="priorite">${["Haute", "Normale", "Basse"].map((p) => `<option ${p === c.priorite ? "selected" : ""}>${p}</option>`).join("")}</select></div>
      <div><label>Reçu le</label><input type="date" name="recu" value="${esc(c.recu)}"></div>
      <div><label>À traiter avant le</label><input type="date" name="echeance" value="${esc(c.echeance)}"></div>
      <div class="full"><label>Action à mener / notes</label><textarea name="note">${esc(c.note)}</textarea></div>
      <div><label>Statut</label><select name="statut">${["À traiter", "En cours", "Traité"].map((p) => `<option ${p === c.statut ? "selected" : ""}>${p}</option>`).join("")}</select></div>
    </form>
    <div class="modal-foot">${id ? `<button class="btn danger" id="del">Supprimer</button><span class="spacer"></span>` : ""}
      <button class="btn" onclick="closeModal()">Annuler</button><button class="btn primary" id="ok">Enregistrer</button></div>`, () => {
    $("#ok").onclick = () => {
      const f = $("#f"); if (!f.reportValidity()) return;
      const d = formData(f);
      if (id) Object.assign(c, d); else state.courrier.push({ id: uid(), ...d });
      save(); closeModal(); route();
    };
    if (id) $("#del").onclick = () => { if (confirm("Supprimer ce courrier ?")) { state.courrier = state.courrier.filter((x) => x.id !== id); save(); closeModal(); route(); } };
  });
}

/* ========== RENDEZ-VOUS DE CARRIÈRE ========== */
function renderRdv(el) {
  const filtre = renderRdv.filtre || "actifs";
  const q = (renderRdv.q || "").toLowerCase();
  const list = state.rdv
    .filter((r) => filtre === "tous" || (filtre === "actifs" ? r.statut !== "Compte rendu envoyé" : r.statut === "Compte rendu envoyé"))
    .filter((r) => !q || (r.enseignant + " " + ecoleLabel(r.uai)).toLowerCase().includes(q))
    .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  const counts = STATUTS_RDV.map((s) => [s, state.rdv.filter((r) => r.statut === s).length]);

  el.innerHTML = `
  <div class="stack">
    <div class="grid grid-4">${counts.map(([s, n]) => `<div class="card stat"><div class="num">${n}</div><div class="lbl">${s}</div></div>`).join("")}</div>
    <div class="card">
      <div class="card-head">
        <h2>Suivi des rendez-vous</h2>
        <div class="row">
          <input class="search" id="rQ" placeholder="Rechercher…" value="${esc(renderRdv.q || "")}">
          <select id="rFiltre" style="width:auto">
            <option value="actifs" ${filtre === "actifs" ? "selected" : ""}>En cours</option>
            <option value="clos" ${filtre === "clos" ? "selected" : ""}>Clos</option>
            <option value="tous" ${filtre === "tous" ? "selected" : ""}>Tous</option>
          </select>
          <button class="btn primary" id="rAdd">${icon("plus")}Nouveau rendez-vous</button>
        </div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Enseignant(e)</th><th>École</th><th>Type</th><th>Statut</th><th></th></tr></thead>
        <tbody>${list.map((r) => `
          <tr class="clickable" data-id="${r.id}">
            <td class="small">${fmtDate(r.date)}${r.heure ? `<br>${esc(r.heure)}` : ""}</td>
            <td><b>${esc(r.enseignant)}</b>${r.niveauClasse ? `<div class="small muted">${esc(r.niveauClasse)}</div>` : ""}</td>
            <td class="small">${esc(ecoleLabel(r.uai) || r.ecoleLibre || "")}</td>
            <td class="small">${esc(r.type)}</td>
            <td><span class="badge ${r.statut === "Réalisé" ? "warn" : r.statut === "Compte rendu envoyé" ? "ok" : r.statut === "Planifié" ? "info" : ""}">${esc(r.statut)}</span></td>
            <td><button class="btn sm" data-grille="${r.id}">Compte rendu</button></td>
          </tr>`).join("") || `<tr><td colspan="6" class="empty">Aucun rendez-vous. Cliquez sur « Nouveau rendez-vous ».</td></tr>`}</tbody>
      </table></div>
    </div>
  </div>`;

  $("#rQ").oninput = (e) => { renderRdv.q = e.target.value; const pos = e.target.selectionStart; route(); const i = $("#rQ"); i.focus(); i.setSelectionRange(pos, pos); };
  $("#rFiltre").onchange = (e) => { renderRdv.filtre = e.target.value; route(); };
  $("#rAdd").onclick = () => editRdv();
  $$("tr[data-id]", el).forEach((tr) => (tr.onclick = () => editRdv(tr.dataset.id)));
  $$("[data-grille]", el).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); location.hash = "#cr/" + b.dataset.grille; }));
}
function editRdv(id, onCreated) {
  const r = id ? state.rdv.find((x) => x.id === id) : { statut: "Planifié", type: TYPES_RDV[0] };
  openModal(id ? "Rendez-vous" : "Nouveau rendez-vous", `
    <form id="f" class="form-grid">
      <div class="row" style="flex-wrap:nowrap;align-items:flex-end"><div style="width:90px"><label>Civilité</label><select name="civilite">${["Mme", "M."].map((c) => `<option ${c === r.civilite ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        <div style="flex:1"><label>Enseignant(e) *</label><input name="enseignant" required value="${esc(r.enseignant)}"></div></div>
      <div><label>Type</label><select name="type">${TYPES_RDV.map((t) => `<option ${t === r.type ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div class="full"><label>École</label><select name="uai">${ecoleOptions(r.uai)}</select></div>
      <div><label>Classe / niveau</label><input name="niveauClasse" value="${esc(r.niveauClasse)}" placeholder="CE1, MS-GS…"></div>
      <div><label>Statut</label><select name="statut">${STATUTS_RDV.map((s) => `<option ${s === r.statut ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <div><label>Date de la visite</label><input type="date" name="date" value="${esc(r.date)}"></div>
      <div><label>Heure</label><input type="time" name="heure" value="${esc(r.heure)}"></div>
      <div><label>Date de l'entretien (si différente)</label><input type="date" name="dateEntretien" value="${esc(r.dateEntretien)}"></div>
      <div><label>Séance observée</label><input name="seance" value="${esc(r.seance)}" placeholder="Domaine, objectif…"></div>
      <div class="full"><label>Points d'attention pour la préparation</label><textarea name="preparation" placeholder="Documents à consulter, historique, demandes de l'enseignant…">${esc(r.preparation)}</textarea></div>
    </form>
    <div class="modal-foot">${id ? `<button class="btn danger" id="del">Supprimer</button><span class="spacer"></span><button class="btn" id="conv">Générer la convocation</button>` : ""}
      <button class="btn" onclick="closeModal()">Annuler</button><button class="btn primary" id="ok">Enregistrer</button></div>`, () => {
    $("#ok").onclick = () => {
      const f = $("#f"); if (!f.reportValidity()) return;
      const d = formData(f);
      const ec = ecoleByUai(d.uai);
      if (ec) { d.ecoleNom = ec.nom; d.ecoleCommune = ec.commune; }
      let created = null;
      if (id) Object.assign(r, d); else state.rdv.push((created = { id: uid(), observations: {}, ...d }));
      save(); closeModal();
      if (created && onCreated) onCreated(created); else route();
    };
    if (id) {
      $("#del").onclick = () => { if (confirm("Supprimer ce rendez-vous ?")) { state.rdv = state.rdv.filter((x) => x.id !== id); save(); closeModal(); route(); } };
      $("#conv").onclick = () => { closeModal(); location.hash = "#redaction"; setTimeout(() => prefillModele("convocation", r), 50); };
    }
  });
}
function compteRendu(r) {
  const lines = [
    `COMPTE RENDU — ${r.type.toUpperCase()}`,
    "",
    `Enseignant(e) : ${r.enseignant}`,
    `École : ${ecoleLabel(r.uai) || "—"}`,
    `Classe : ${r.niveauClasse || "—"}`,
    `Date de la visite : ${fmtDate(r.date, { day: "numeric", month: "long", year: "numeric" })}`,
    r.seance ? `Séance observée : ${r.seance}` : "",
    "",
    "COMPÉTENCES OBSERVÉES",
    "",
  ];
  COMPETENCES.forEach((c, i) => {
    const o = (r.observations || {})[i] || {};
    if (!o.niveau && !o.texte) return;
    lines.push(`${i + 1}. ${c}`);
    if (o.niveau) lines.push(`   Niveau : ${o.niveau}`);
    if (o.texte) lines.push(`   ${o.texte}`);
    lines.push("");
  });
  lines.push("APPRÉCIATION GÉNÉRALE", "", r.synthese || "…", "", "", `L'inspectrice de l'Éducation nationale${state.settings.nom ? ",\n" + state.settings.nom : ""}`);
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "" && a[i - 2] === "")).join("\n");
}

/* ========== ÉCOLES ========== */
function renderEcoles(el) {
  el.innerHTML = `<div class="card"><p class="muted">Chargement de l'annuaire des écoles…</p></div>`;
  loadEcoles().then(() => {
    const q = (renderEcoles.q || "").toLowerCase();
    const list = ecoles.filter((e) => !q || (e.nom + " " + e.commune + " " + (ecoleNotes(e.uai).directeur || "")).toLowerCase().includes(q));
    const totalEff = ecoles.reduce((s, e) => s + (parseInt(ecoleNotes(e.uai).effectif) || 0), 0);
    const communes = new Set(ecoles.map((e) => e.commune)).size;
    const today = todayISO();
    const conseils = ecoles.flatMap((e) => (ecoleNotes(e.uai).conseils || "").split(/[\s,;]+/).filter(Boolean).map((d) => ({ d, e })))
      .filter((x) => x.d >= today).sort((a, b) => a.d.localeCompare(b.d));
    el.innerHTML = `
    <div class="stack">
      <div class="grid grid-4">
        <div class="card stat"><div class="num">${ecoles.length}</div><div class="lbl">Écoles</div></div>
        <div class="card stat"><div class="num">${communes}</div><div class="lbl">Communes</div></div>
        <div class="card stat"><div class="num">${ecoles.filter((e) => e.prive).length}</div><div class="lbl">Écoles privées</div></div>
        <div class="card stat"><div class="num">${totalEff || "—"}</div><div class="lbl">Élèves (effectifs saisis)</div></div>
      </div>
      ${conseils.length ? `<div class="card"><div class="card-head"><h2>Prochains conseils d'école</h2></div><ul class="list">${conseils.slice(0, 5).map((x) => `<li>${dateChip(x.d)}<div>${esc(x.e.nom)} <span class="muted small">(${esc(x.e.commune)})</span></div></li>`).join("")}</ul></div>` : ""}
      <div class="card">
        <div class="card-head"><h2>Annuaire</h2><input class="search" id="eQ" placeholder="Rechercher une école, une commune, un directeur…" value="${esc(renderEcoles.q || "")}"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>École</th><th>Commune</th><th>Type</th><th>Direction</th><th>Effectif</th><th>Contact</th></tr></thead>
          <tbody>${list.map((e) => { const n = ecoleNotes(e.uai); return `
            <tr class="clickable" data-uai="${e.uai}">
              <td><b>${esc(e.nom)}</b> ${e.prive ? '<span class="badge">privé</span>' : ""} ${e.ulis ? '<span class="badge info">ULIS</span>' : ""} ${e.rep ? `<span class="badge warn">${esc(e.rep)}</span>` : ""}
                ${n.notes ? `<div class="small muted">📝 ${esc(n.notes.slice(0, 80))}</div>` : ""}</td>
              <td>${esc(e.commune)}</td><td class="small">${e.niveau}</td>
              <td class="small">${esc(n.directeur || "—")}</td><td>${esc(n.effectif || "—")}</td>
              <td class="small">${e.tel ? `<a style="white-space:nowrap" href="tel:${esc(e.tel)}" onclick="event.stopPropagation()">${esc(e.tel.replace(/(\d{2})(?=\d)/g, "$1 "))}</a><br>` : ""}${e.mail ? `<a href="mailto:${esc(e.mail)}" onclick="event.stopPropagation()" title="${esc(e.mail)}">✉️ Écrire</a>` : ""}</td>
            </tr>`; }).join("") || `<tr><td colspan="6" class="empty">Aucune école trouvée.</td></tr>`}</tbody>
        </table></div>
        <p class="small muted">Source : annuaire de l'Éducation nationale (données publiques, mises à jour automatiquement). Cliquez sur une école pour ajouter vos propres informations.</p>
      </div>
    </div>`;
    $("#eQ").oninput = (ev) => { renderEcoles.q = ev.target.value; const p = ev.target.selectionStart; renderEcoles(el); setTimeout(() => { const i = $("#eQ"); if (i) { i.focus(); i.setSelectionRange(p, p); } }, 0); };
    $$("tr[data-uai]", el).forEach((tr) => (tr.onclick = () => editEcole(tr.dataset.uai)));
  });
}
function editEcole(uai) {
  const e = ecoleByUai(uai);
  const n = ecoleNotes(uai);
  const rdvs = state.rdv.filter((r) => r.uai === uai);
  openModal(e.nom, `
    <p class="small muted" style="margin-top:0">${esc(e.adresse)} · ${esc(e.commune)} · UAI ${esc(e.uai)}</p>
    <form id="f" class="form-grid">
      <div><label>Directeur / directrice</label><input name="directeur" value="${esc(n.directeur)}"></div>
      <div><label>Effectif élèves</label><input type="number" name="effectif" value="${esc(n.effectif)}"></div>
      <div><label>Nombre de classes</label><input type="number" name="classes" value="${esc(n.classes)}"></div>
      <div><label>Dates des conseils d'école</label><input name="conseils" value="${esc(n.conseils)}" placeholder="2026-11-07, 2027-03-12"></div>
      <div class="full"><label>Projet d'école / points de vigilance / notes</label><textarea name="notes" rows="5">${esc(n.notes)}</textarea></div>
    </form>
    ${rdvs.length ? `<h3 style="margin-top:16px">Rendez-vous dans cette école</h3><ul class="list">${rdvs.map((r) => `<li>${dateChip(r.date)}<div>${esc(r.enseignant)} <span class="small muted">· ${esc(r.type)}</span></div></li>`).join("")}</ul>` : ""}
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn primary" id="ok">Enregistrer</button></div>`, () => {
    $("#ok").onclick = () => { state.ecolesNotes[uai] = formData($("#f")); save(); closeModal(); route(); };
  });
}

/* ========== TRAJETS ========== */
let map = null;
function renderTrajets(el) {
  const sel = new Set(renderTrajets.sel || []);
  const today = todayISO();
  el.innerHTML = `
  <div class="stack">
    <div class="notice">Cochez les écoles à visiter dans la journée. L'outil calcule l'ordre de passage le plus court en voiture, au départ et au retour de votre point de départ.</div>
    <div class="grid grid-trajets">
      <div class="card stack">
        <div>
          <label>Point de départ</label>
          <div class="row"><input id="tDepart" value="${esc(state.settings.depart.label)}" readonly style="flex:1"><button class="btn sm" id="tSetDepart" title="Cliquez ensuite sur la carte">📍 Changer</button></div>
        </div>
        <div class="row">
          <button class="btn sm" id="tRdvJour">Écoles des RDV d'un jour…</button>
          <button class="btn sm" id="tClear">Tout décocher</button>
        </div>
        <input id="tQ" placeholder="Filtrer…">
        <div class="school-pick" id="tList"><p class="muted">Chargement…</p></div>
        <button class="btn primary" id="tGo">Calculer le meilleur itinéraire</button>
      </div>
      <div class="stack">
        <div id="map"></div>
        <div class="card" id="tResult"><p class="muted">Aucun itinéraire calculé.</p></div>
      </div>
    </div>
  </div>`;

  map = L.map("map").setView([43.68, 6.85], 10);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map);
  const markers = {};
  let routeLayer = null;
  const homeIcon = L.divIcon({ html: "🏠", className: "", iconSize: [24, 24] });
  let homeMarker = L.marker([state.settings.depart.lat, state.settings.depart.lon], { icon: homeIcon }).addTo(map).bindTooltip("Départ");
  let pickingDepart = false;

  $("#tSetDepart").onclick = () => { pickingDepart = true; toast("Cliquez sur la carte pour placer le point de départ"); };
  map.on("click", (ev) => {
    if (!pickingDepart) return;
    pickingDepart = false;
    const label = prompt("Nom de ce point de départ :", "Bureau de la circonscription") || "Point de départ";
    state.settings.depart = { label, lat: ev.latlng.lat, lon: ev.latlng.lng }; save();
    homeMarker.setLatLng(ev.latlng); $("#tDepart").value = label;
  });

  loadEcoles().then(() => {
    const drawList = () => {
      const q = ($("#tQ").value || "").toLowerCase();
      $("#tList").innerHTML = ecoles.filter((e) => e.lat && (!q || (e.nom + e.commune).toLowerCase().includes(q))).map((e) =>
        `<label><input type="checkbox" value="${e.uai}" ${sel.has(e.uai) ? "checked" : ""}><span><b>${esc(e.commune)}</b><br><span class="small">${esc(e.nom)}</span></span></label>`).join("");
      $$("#tList input").forEach((cb) => (cb.onchange = () => { cb.checked ? sel.add(cb.value) : sel.delete(cb.value); renderTrajets.sel = [...sel]; paint(); }));
    };
    const paint = () => ecoles.forEach((e) => {
      if (!e.lat) return;
      if (!markers[e.uai]) markers[e.uai] = L.circleMarker([e.lat, e.lon], { radius: 6, weight: 2 }).addTo(map)
        .bindTooltip(`${e.nom} (${e.commune})`).on("click", () => { sel.has(e.uai) ? sel.delete(e.uai) : sel.add(e.uai); renderTrajets.sel = [...sel]; drawList(); paint(); });
      markers[e.uai].setStyle(sel.has(e.uai) ? { color: "#d9822b", fillColor: "#d9822b", fillOpacity: .9, radius: 8 } : { color: "#1f4e9c", fillColor: "#1f4e9c", fillOpacity: .4, radius: 6 });
    });
    drawList(); paint();
    $("#tQ").oninput = drawList;
    $("#tClear").onclick = () => { sel.clear(); renderTrajets.sel = []; drawList(); paint(); };
    $("#tRdvJour").onclick = () => {
      const d = prompt("Date des rendez-vous (AAAA-MM-JJ) :", today);
      if (!d) return;
      const uais = state.rdv.filter((r) => r.date === d && r.uai).map((r) => r.uai);
      if (!uais.length) return toast("Aucun rendez-vous avec école ce jour-là");
      sel.clear(); uais.forEach((u) => sel.add(u)); renderTrajets.sel = [...sel]; drawList(); paint();
    };
  });

  $("#tGo").onclick = async () => {
    const pts = [...sel].map(ecoleByUai).filter((e) => e && e.lat);
    if (!pts.length) return toast("Sélectionnez au moins une école");
    const dep = state.settings.depart;
    const coords = [[dep.lon, dep.lat], ...pts.map((e) => [e.lon, e.lat])].map((c) => c.join(",")).join(";");
    $("#tResult").innerHTML = `<p class="muted">Calcul en cours…</p>`;
    try {
      const res = await fetch(`${OSRM_URL}${coords}?roundtrip=true&source=first&geometries=geojson&overview=full`);
      const data = await res.json();
      if (data.code !== "Ok") throw new Error(data.message || data.code);
      const trip = data.trips[0];
      const order = data.waypoints.map((w, i) => ({ i, pos: w.waypoint_index })).sort((a, b) => a.pos - b.pos).map((x) => x.i);
      const km = trip.distance / 1000;
      const min = Math.round(trip.duration / 60);
      if (routeLayer) routeLayer.remove();
      routeLayer = L.geoJSON(trip.geometry, { style: { color: "#d9822b", weight: 5, opacity: .8 } }).addTo(map);
      map.fitBounds(routeLayer.getBounds(), { padding: [30, 30] });
      const steps = order.slice(1).map((i) => pts[i - 1]);
      const legs = trip.legs;
      $("#tResult").innerHTML = `
        <div class="card-head"><h2>Itinéraire optimisé</h2>
          <div class="row"><span class="badge info">${km.toFixed(1)} km</span><span class="badge info">${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} de route</span>
          <span class="badge ok">≈ ${(km * state.settings.bareme).toFixed(2)} € de frais</span></div></div>
        <ol class="route-steps">
          <li class="home"><b>${esc(dep.label)}</b> <span class="small muted">départ</span></li>
          ${steps.map((e, k) => `<li><b>${esc(e.nom)}</b> — ${esc(e.commune)} <span class="small muted">(${(legs[k].distance / 1000).toFixed(1)} km, ${Math.round(legs[k].duration / 60)} min)</span></li>`).join("")}
          <li class="home"><b>Retour : ${esc(dep.label)}</b> <span class="small muted">(${(legs[legs.length - 1].distance / 1000).toFixed(1)} km, ${Math.round(legs[legs.length - 1].duration / 60)} min)</span></li>
        </ol>
        <div class="row" style="margin-top:12px">
          <a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/${[dep, ...steps, dep].map((p) => `${p.lat},${p.lon}`).join("/")}">Ouvrir dans Google Maps</a>
          <span class="small muted">Frais estimés avec un barème de ${state.settings.bareme} €/km (modifiable dans Réglages).</span>
        </div>`;
    } catch (err) {
      $("#tResult").innerHTML = `<p class="muted">Le calcul d'itinéraire a échoué (${esc(err.message)}). Réessayez dans un instant.</p>`;
    }
  };
}

/* ========== ANIMATIONS PÉDAGOGIQUES ========== */
function renderAnimations(el) {
  const list = [...state.animations].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const total = list.reduce((s, a) => s + (parseFloat(a.duree) || 0), 0);
  const today = todayISO();
  el.innerHTML = `
  <div class="stack">
    <div class="grid grid-4">
      <div class="card stat"><div class="num">${list.length}</div><div class="lbl">Sessions</div></div>
      <div class="card stat"><div class="num">${total} h</div><div class="lbl">Volume horaire planifié</div></div>
      <div class="card stat"><div class="num">${list.filter((a) => a.date >= today).length}</div><div class="lbl">À venir</div></div>
      <div class="card stat"><div class="num">${list.reduce((s, a) => s + (a.participants || []).length, 0)}</div><div class="lbl">Inscriptions</div></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Sessions</h2><button class="btn primary" id="aAdd">${icon("plus")}Nouvelle animation</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Intitulé</th><th>Public</th><th>Lieu</th><th>Durée</th><th>Inscrits</th><th></th></tr></thead>
        <tbody>${list.map((a) => `
          <tr class="clickable" data-id="${a.id}">
            <td class="small">${fmtDate(a.date)}${a.heure ? `<br>${esc(a.heure)}` : ""}</td>
            <td><b>${esc(a.titre)}</b> ${a.date < today ? '<span class="badge">passée</span>' : ""}</td>
            <td class="small">${esc(a.public)}</td><td class="small">${esc(a.lieu)}</td>
            <td>${esc(a.duree)} h</td><td>${(a.participants || []).length}</td>
            <td><button class="btn sm" data-em="${a.id}">Émargement</button></td>
          </tr>`).join("") || `<tr><td colspan="7" class="empty">Aucune animation.</td></tr>`}</tbody>
      </table></div>
    </div>
  </div>`;
  $("#aAdd").onclick = () => editAnimation();
  $$("tr[data-id]", el).forEach((tr) => (tr.onclick = () => editAnimation(tr.dataset.id)));
  $$("[data-em]", el).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); emargement(b.dataset.em); }));
}
function editAnimation(id) {
  const a = id ? state.animations.find((x) => x.id === id) : { duree: "3", participants: [] };
  openModal(id ? "Animation pédagogique" : "Nouvelle animation pédagogique", `
    <form id="f" class="form-grid">
      <div class="full"><label>Intitulé *</label><input name="titre" required value="${esc(a.titre)}"></div>
      <div><label>Date *</label><input type="date" name="date" required value="${esc(a.date)}"></div>
      <div><label>Horaire</label><input name="heure" value="${esc(a.heure)}" placeholder="17h00 – 20h00"></div>
      <div><label>Durée (heures)</label><input type="number" step="0.5" name="duree" value="${esc(a.duree)}"></div>
      <div><label>Lieu</label><input name="lieu" value="${esc(a.lieu)}"></div>
      <div><label>Public visé</label><input name="public" value="${esc(a.public)}" placeholder="Cycle 2, PE de maternelle…"></div>
      <div><label>Intervenant(s)</label><input name="intervenants" value="${esc(a.intervenants)}" placeholder="CPC, IEN…"></div>
      <div class="full"><label>Objectifs / contenu</label><textarea name="description">${esc(a.description)}</textarea></div>
      <div class="full"><label>Participants (un par ligne : Nom Prénom — École)</label><textarea name="participants" rows="6">${esc((a.participants || []).join("\n"))}</textarea></div>
    </form>
    <div class="modal-foot">${id ? `<button class="btn danger" id="del">Supprimer</button><span class="spacer"></span><button class="btn" id="dup">Dupliquer</button>` : ""}
      <button class="btn" onclick="closeModal()">Annuler</button><button class="btn primary" id="ok">Enregistrer</button></div>`, () => {
    $("#ok").onclick = () => {
      const f = $("#f"); if (!f.reportValidity()) return;
      const d = formData(f);
      d.participants = d.participants.split("\n").map((s) => s.trim()).filter(Boolean);
      if (id) Object.assign(a, d); else state.animations.push({ id: uid(), ...d });
      save(); closeModal(); route();
    };
    if (id) {
      $("#del").onclick = () => { if (confirm("Supprimer cette animation ?")) { state.animations = state.animations.filter((x) => x.id !== id); save(); closeModal(); route(); } };
      $("#dup").onclick = () => { state.animations.push({ ...a, id: uid(), date: "", participants: [] }); save(); closeModal(); route(); toast("Animation dupliquée (date à renseigner)"); };
    }
  });
}
function emargement(id) {
  const a = state.animations.find((x) => x.id === id);
  const rows = [...(a.participants || [])];
  const target = Math.max(15, rows.length + 3);
  while (rows.length < target) rows.push("");
  openModal("Feuille d'émargement", `
    <div>
      <h2 style="text-align:center">Feuille d'émargement</h2>
      <p style="text-align:center;margin:4px 0 0"><b>${esc(a.titre)}</b></p>
      <p style="text-align:center" class="small">${fmtDate(a.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} ${a.heure ? "· " + esc(a.heure) : ""} · ${esc(a.lieu || "")} · ${esc(a.duree)} h<br>
      Circonscription de Grasse ${a.intervenants ? "· Intervenant(s) : " + esc(a.intervenants) : ""}</p>
      <table style="margin-top:12px"><thead><tr><th style="width:40px">#</th><th>Nom, prénom — école</th><th style="width:35%">Signature</th></tr></thead>
      <tbody>${rows.map((p, i) => `<tr><td>${i + 1}</td><td style="height:34px">${esc(p)}</td><td></td></tr>`).join("")}</tbody></table>
    </div>
    <div class="modal-foot no-print">
      <button class="btn" id="csv">Exporter la liste (Excel)</button>
      <button class="btn primary" onclick="window.print()">Imprimer</button>
    </div>`, () => {
    $("#csv").onclick = () => download(`emargement-${(a.date || "")}.csv`, "﻿N°;Participant;Signature\n" + (a.participants || []).map((p, i) => `${i + 1};"${p.replace(/"/g, '""')}";`).join("\n"), "text/csv");
  });
}

/* ========== AIDE À LA RÉDACTION ========== */
const MODELES = {
  convocation: {
    nom: "Convocation à un rendez-vous de carrière",
    champs: ["enseignant", "ecole", "date", "heure", "type"],
    texte: (v) => `Objet : ${v.type || "Rendez-vous de carrière"}

Madame, Monsieur ${v.enseignant || "[Nom]"},

Dans le cadre du parcours professionnels, carrières et rémunérations (PPCR), j'ai le plaisir de vous informer que votre ${(v.type || "rendez-vous de carrière").toLowerCase()} aura lieu le ${v.date ? fmtDate(v.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "[date]"}${v.heure ? " à " + v.heure : ""}, à l'${v.ecole || "[école]"}.

Ce rendez-vous comprendra une observation de séance en classe, suivie d'un entretien. Je vous invite à tenir à disposition votre cahier journal, vos progressions et programmations, ainsi que les outils de suivi des élèves.

Le document de référence de l'entretien professionnel est disponible sur le site de l'académie ; il peut vous aider à préparer ce temps d'échange.

Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.

L'inspectrice de l'Éducation nationale
${state.settings.nom || ""}`,
  },
  invitation: {
    nom: "Invitation à une animation pédagogique",
    champs: ["titre", "date", "heure", "lieu", "public"],
    texte: (v) => `Objet : Animation pédagogique — ${v.titre || "[intitulé]"}

Mesdames et Messieurs les directeurs et enseignants,

Dans le cadre du plan de formation de la circonscription de Grasse, une animation pédagogique « ${v.titre || "[intitulé]"} » se tiendra le ${v.date ? fmtDate(v.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "[date]"}${v.heure ? ", de " + v.heure : ""}, ${v.lieu ? "à " + v.lieu : "[lieu]"}.

Public concerné : ${v.public || "[public]"}.

Cette animation est comptabilisée dans les 18 heures d'animations pédagogiques et de formation. Je vous remercie de bien vouloir confirmer votre présence auprès du secrétariat de la circonscription.

Je vous remercie de votre engagement.

L'inspectrice de l'Éducation nationale
${state.settings.nom || ""}`,
  },
  directeurs: {
    nom: "Courrier aux directeurs d'école",
    champs: ["objet", "contenu", "echeance"],
    texte: (v) => `Objet : ${v.objet || "[objet]"}

Mesdames et Messieurs les directeurs d'école,

${v.contenu || "[contenu]"}

${v.echeance ? `Je vous remercie de bien vouloir me faire parvenir les éléments demandés avant le ${fmtDate(v.echeance, { day: "numeric", month: "long", year: "numeric" })}.\n\n` : ""}Je vous remercie de votre collaboration.

L'inspectrice de l'Éducation nationale
${state.settings.nom || ""}`,
  },
  conseil: {
    nom: "Retour sur un procès-verbal de conseil d'école",
    champs: ["ecole", "date", "contenu"],
    texte: (v) => `Objet : Procès-verbal du conseil d'école du ${v.date ? fmtDate(v.date, { day: "numeric", month: "long", year: "numeric" }) : "[date]"}

Madame, Monsieur le directeur,

J'accuse réception du procès-verbal du conseil d'école de l'${v.ecole || "[école]"} et vous en remercie.

${v.contenu || "[remarques]"}

Je vous prie d'agréer l'expression de mes salutations distinguées.

L'inspectrice de l'Éducation nationale
${state.settings.nom || ""}`,
  },
};
const CHAMPS = {
  enseignant: ["Enseignant(e)", "text"], ecole: ["École", "text"], date: ["Date", "date"], heure: ["Heure", "text"],
  type: ["Type de rendez-vous", "text"], titre: ["Intitulé", "text"], lieu: ["Lieu", "text"], public: ["Public", "text"],
  objet: ["Objet", "text"], contenu: ["Contenu / remarques", "textarea"], echeance: ["Date limite de réponse", "date"],
};
function renderRedaction(el) {
  el.innerHTML = `
  <div class="stack">
    <div class="tabs"><button class="active" data-t="modeles">📄 Modèles de courriers</button><button data-t="ia">✨ Assistant IA</button></div>
    <div id="t-modeles" class="grid grid-2">
      <div class="card stack">
        <div><label>Modèle</label><select id="mSel">${Object.entries(MODELES).map(([k, m]) => `<option value="${k}">${m.nom}</option>`).join("")}</select></div>
        <form id="mForm" class="stack"></form>
      </div>
      <div class="card">
        <div class="card-head"><h2>Aperçu</h2><div class="row"><button class="btn sm" id="mCopy">Copier</button><button class="btn sm" id="mWord">Word</button></div></div>
        <div class="output" id="mOut" contenteditable="true"></div>
        <p class="small muted">Le texte est modifiable directement dans l'aperçu avant copie.</p>
      </div>
    </div>
    <div id="t-ia" hidden class="stack">
      <div class="notice warn"><b>Confidentialité :</b> le texte est envoyé à l'IA Claude (Anthropic). N'y mettez <b>aucune donnée nominative</b> (noms d'enseignants, d'élèves, d'écoles) :
      utilisez le bouton « Anonymiser » ou des initiales. ${getApiKey() ? "" : `<br>Une clé d'API est nécessaire : <a href="#parametres">la renseigner dans Réglages</a>.`}</div>
      <div class="grid grid-2">
        <div class="card stack">
          <div><label>Que voulez-vous faire ?</label>
            <select id="iaTache">
              <option value="Reformule ces notes brutes de visite de classe en un compte rendu de rendez-vous de carrière structuré, bienveillant et précis, en t'appuyant sur le référentiel de compétences des professeurs.">Notes de visite → compte rendu structuré</option>
              <option value="Rédige un courrier administratif clair et courtois, dans le style d'une inspectrice de l'Éducation nationale, à partir des éléments suivants.">Rédiger un courrier</option>
              <option value="Améliore la formulation de ce texte (ton professionnel, bienveillant, précis), sans en changer le sens.">Améliorer la formulation</option>
              <option value="Résume ce texte (circulaire, note de service…) en points clés, puis liste les actions à mener et les échéances.">Résumer une circulaire</option>
              <option value="Propose un déroulé détaillé d'animation pédagogique (objectifs, phases, durées, supports) sur le thème suivant.">Concevoir une animation pédagogique</option>
            </select></div>
          <div><label>Votre texte</label><textarea id="iaIn" rows="12" placeholder="Collez vos notes ou décrivez votre besoin…"></textarea></div>
          <div><label>Noms à masquer (séparés par des virgules)</label><input id="iaNoms" placeholder="Dupont, Martin, École Gambetta…"></div>
          <div class="row"><button class="btn" id="iaAnon">Anonymiser</button><span class="spacer"></span><button class="btn primary" id="iaGo">✨ Générer</button></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Résultat</h2><div class="row"><button class="btn sm" id="iaRestore" title="Remet les vrais noms dans le résultat">Rétablir les noms</button><button class="btn sm" id="iaCopy">Copier</button><button class="btn sm" id="iaWord">Word</button></div></div>
          <div class="output" id="iaOut" contenteditable="true"></div>
        </div>
      </div>
    </div>
  </div>`;

  $$(".tabs button", el).forEach((b) => (b.onclick = () => {
    $$(".tabs button", el).forEach((x) => x.classList.toggle("active", x === b));
    $("#t-modeles").hidden = b.dataset.t !== "modeles";
    $("#t-ia").hidden = b.dataset.t !== "ia";
  }));

  const drawForm = (vals = {}) => {
    const m = MODELES[$("#mSel").value];
    $("#mForm").innerHTML = m.champs.map((c) => {
      const [lbl, type] = CHAMPS[c];
      return `<div><label>${lbl}</label>${type === "textarea" ? `<textarea name="${c}" rows="5">${esc(vals[c])}</textarea>` : `<input type="${type}" name="${c}" value="${esc(vals[c])}">`}</div>`;
    }).join("");
    const upd = () => ($("#mOut").textContent = m.texte(formData($("#mForm"))));
    $("#mForm").oninput = upd; upd();
  };
  $("#mSel").onchange = () => drawForm();
  drawForm();
  $("#mCopy").onclick = () => copy($("#mOut").innerText);
  $("#mWord").onclick = () => downloadWord("courrier.doc", "Courrier", $("#mOut").innerText);
  renderRedaction.prefill = (key, vals) => { $("#mSel").value = key; drawForm(vals); };

  // Assistant IA
  let mapping = [];
  $("#iaAnon").onclick = () => {
    const noms = $("#iaNoms").value.split(",").map((s) => s.trim()).filter(Boolean);
    let t = $("#iaIn").value;
    mapping = noms.map((n, i) => [n, `[PERSONNE ${String.fromCharCode(65 + i)}]`]);
    mapping.forEach(([n, tag]) => { t = t.split(n).join(tag); });
    $("#iaIn").value = t;
    toast(mapping.length ? `${mapping.length} nom(s) masqué(s)` : "Indiquez les noms à masquer");
  };
  $("#iaRestore").onclick = () => {
    let t = $("#iaOut").innerText;
    mapping.forEach(([n, tag]) => { t = t.split(tag).join(n); });
    $("#iaOut").textContent = t;
  };
  $("#iaCopy").onclick = () => copy($("#iaOut").innerText);
  $("#iaWord").onclick = () => downloadWord("texte.doc", "Texte", $("#iaOut").innerText);
  $("#iaGo").onclick = async () => {
    const key = getApiKey();
    if (!key) return toast("Renseignez d'abord la clé d'API dans Réglages");
    const input = $("#iaIn").value.trim();
    if (!input) return toast("Saisissez un texte");
    const btn = $("#iaGo"); btn.disabled = true; btn.textContent = "Génération…";
    $("#iaOut").textContent = "";
    try {
      $("#iaOut").textContent = await askClaude(key, $("#iaTache").value, input);
    } catch (err) {
      $("#iaOut").textContent = "Erreur : " + err.message;
    } finally { btn.disabled = false; btn.textContent = "✨ Générer"; }
  };
}
function prefillModele(key, r) {
  if (!renderRedaction.prefill) return;
  renderRedaction.prefill(key, { enseignant: r.enseignant, ecole: ecoleLabel(r.uai), date: r.date, heure: r.heure, type: r.type });
}
// Appel direct à l'API Claude depuis le navigateur, avec la clé personnelle saisie dans Réglages.
async function askClaude(key, tache, texte) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium" },
      fallbacks: "default",
      system: "Tu assistes une inspectrice de l'Éducation nationale du premier degré (circonscription de Grasse, académie de Nice). Tu écris en français soutenu et administratif, avec un ton bienveillant et précis. Tu conserves tels quels les marqueurs du type [PERSONNE A]. Tu réponds directement par le texte demandé, sans préambule, en texte brut sans Markdown.",
      messages: [{ role: "user", content: `${tache}\n\n${texte}` }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  if (data.stop_reason === "refusal") throw new Error("la demande a été refusée par le modèle.");
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

/* ========== PARAMÈTRES ========== */
function renderParametres(el) {
  const s = state.settings;
  el.innerHTML = `
  <div class="stack">
    <div class="card">
      <div class="card-head"><h2>Profil</h2></div>
      <form id="pForm" class="form-grid">
        <div><label>Votre nom (pour la signature et l'accueil)</label><input name="nom" value="${esc(s.nom)}"></div>
        <div><label>Barème kilométrique (€/km)</label><input type="number" step="0.01" name="bareme" value="${esc(s.bareme)}"></div>
        <div><label>Apparence</label><select name="theme">${[["light", "Claire"], ["dark", "Sombre"], ["auto", "Automatique (selon l'appareil)"]].map(([v, l]) => `<option value="${v}" ${(s.theme || "light") === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      </form>
    </div>
    <div class="card">
      <div class="card-head"><h2>Accès rapides</h2><button class="btn sm" id="lAdd">${icon("plus")}Ajouter</button></div>
      <div id="liens" class="stack"></div>
    </div>
    <div class="card stack">
      <h2>Assistant IA (facultatif)</h2>
      <p class="small muted" style="margin:0">L'assistant utilise une clé d'API Claude personnelle, créée sur console.anthropic.com (facturation à l'usage, quelques centimes par texte).
      Elle est stockée uniquement dans ce navigateur.</p>
      <div class="row"><input type="password" id="apiKey" placeholder="sk-ant-…" value="${esc(getApiKey())}" style="flex:1;min-width:200px"><button class="btn" id="apiSave">Enregistrer la clé</button></div>
    </div>
    <div class="card stack">
      <h2>Sauvegarde</h2>
      <p class="small muted" style="margin:0">Vos données sont enregistrées dans ce navigateur, sur cet ordinateur uniquement. Elles ne sont envoyées nulle part.
      Pensez à télécharger régulièrement une sauvegarde, par exemple chaque semaine, et utilisez-la pour retrouver vos données sur un autre ordinateur.</p>
      <div class="row">
        <button class="btn primary" id="bExport">⬇️ Télécharger une sauvegarde</button>
        <label class="btn" style="margin:0;color:var(--text);font-weight:400">⬆️ Restaurer une sauvegarde<input type="file" id="bImport" accept=".json" hidden></label>
        <span class="spacer"></span>
        <button class="btn danger" id="bReset">Effacer toutes les données</button>
      </div>
    </div>
  </div>`;

  $("#pForm").oninput = $("#pForm").onchange = () => { const d = formData($("#pForm")); s.nom = d.nom; s.bareme = parseFloat(d.bareme) || 0; s.theme = d.theme; appliquerTheme(); save(); };
  const drawLiens = () => {
    $("#liens").innerHTML = s.liens.map((l, i) => `
      <div class="row"><input data-i="${i}" data-k="icon" value="${esc(l.icon)}" style="width:56px"><input data-i="${i}" data-k="label" value="${esc(l.label)}" style="flex:1;min-width:140px">
      <input data-i="${i}" data-k="url" value="${esc(l.url)}" style="flex:2;min-width:200px"><button class="btn sm danger" data-del="${i}">✕</button></div>`).join("");
    $$("#liens input").forEach((inp) => (inp.oninput = () => { s.liens[inp.dataset.i][inp.dataset.k] = inp.value; save(); }));
    $$("#liens [data-del]").forEach((b) => (b.onclick = () => { s.liens.splice(+b.dataset.del, 1); save(); drawLiens(); }));
  };
  drawLiens();
  $("#lAdd").onclick = () => { s.liens.push({ icon: "🔗", label: "Nouveau lien", url: "https://" }); save(); drawLiens(); };
  $("#apiSave").onclick = () => { setApiKey($("#apiKey").value.trim()); toast("Clé enregistrée"); };
  $("#bExport").onclick = () => download(`sauvegarde-circonscription-${todayISO()}.json`, JSON.stringify(state, null, 2), "application/json");
  $("#bImport").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.settings) throw new Error();
      if (!confirm("Remplacer les données actuelles par cette sauvegarde ?")) return;
      state = Object.assign(defaultState(), data); save(); toast("Sauvegarde restaurée"); route();
    } catch (err) { toast("Fichier de sauvegarde invalide"); }
  };
  $("#bReset").onclick = () => {
    if (!confirm("Effacer définitivement toutes les données de ce navigateur ? Téléchargez une sauvegarde avant.")) return;
    state = defaultState(); save(); route();
  };
}

/* ========== COMPTES RENDUS ========== */
const initials = (name) => (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
const icon = (name) => `<svg class="i"><use href="#i-${name}"/></svg>`;
const nbCompetences = (r) => COMPETENCES.filter((_, i) => { const o = (r.observations || {})[i] || {}; return o.niveau || o.texte; }).length;
function crEtat(r) {
  if (r.statut === "Compte rendu envoyé") return "envoye";
  if (r.crFinal) return "pret";
  return "arediger";
}
function crListe() {
  const today = todayISO();
  return state.rdv.filter((r) => r.statut === "Réalisé" || r.statut === "Compte rendu envoyé" || r.crFinal || nbCompetences(r) || (r.date && r.date <= today));
}

function renderCR(el, id) {
  if (id) return renderCREditeur(el, id);
  const filtre = renderCR.filtre || "arediger";
  const all = crListe();
  const counts = { arediger: 0, pret: 0, envoye: 0 };
  all.forEach((r) => counts[crEtat(r)]++);
  const list = all.filter((r) => crEtat(r) === filtre).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const labels = { arediger: "À rédiger", pret: "Prêts", envoye: "Envoyés" };

  el.innerHTML = `
  <div class="stack">
    <div class="page-head">
      <div><h2>Comptes rendus</h2><p>Grille d'observation, rédaction assistée, puis export Word.</p></div>
      <span class="spacer"></span>
      <button class="btn primary" id="crNew">${icon("plus")}Nouvelle visite</button>
    </div>
    <div class="seg" id="crSeg">${Object.entries(labels).map(([k, l]) => `<button data-f="${k}" class="${k === filtre ? "active" : ""}">${l} <span class="muted">${counts[k]}</span></button>`).join("")}</div>
    <div class="card">
      <ul class="list">${list.map((r) => `
        <li class="link" data-id="${r.id}">
          <div class="avatar sm">${esc(initials(r.enseignant))}</div>
          <div style="flex:1;min-width:0">
            <div><b>${esc(r.civilite ? r.civilite + " " : "")}${esc(r.enseignant)}</b> <span class="small muted">· ${esc(r.type)}</span></div>
            <div class="small muted">${esc(ecoleLabel(r.uai) || "École non renseignée")} · ${fmtDate(r.date, { day: "numeric", month: "long" })}</div>
          </div>
          <span class="small muted" title="Compétences renseignées">${nbCompetences(r)}/11</span>
          <button class="btn sm ${filtre === "arediger" ? "primary" : ""}">${filtre === "envoye" ? "Ouvrir" : "Rédiger"}</button>
        </li>`).join("") || `<li class="empty">${filtre === "arediger" ? "Aucun compte rendu en attente. Les visites réalisées apparaissent ici." : "Aucun compte rendu dans cette catégorie."}</li>`}</ul>
    </div>
  </div>`;
  $$("#crSeg button").forEach((b) => (b.onclick = () => { renderCR.filtre = b.dataset.f; route(); }));
  $$("li[data-id]", el).forEach((li) => (li.onclick = () => (location.hash = "#cr/" + li.dataset.id)));
  $("#crNew").onclick = () => editRdv(null, (r) => (location.hash = "#cr/" + r.id));
}

// Masque les noms propres avant tout envoi vers une IA, et permet de les rétablir ensuite.
// Fiche école copiée dans le rendez-vous : le masquage ne dépend pas du chargement de l'annuaire.
const ecoleDuRdv = (r) => ecoleByUai(r.uai) || (r.ecoleNom ? { nom: r.ecoleNom, commune: r.ecoleCommune || "" } : null);
const ecoleEnTexte = (e) => (e ? "l'" + e.nom.replace(/^[EÉ]cole/, "école") : "l'école");
function crMasques(r) {
  const e = ecoleDuRdv(r);
  const pairs = [];
  if (r.enseignant) {
    pairs.push([r.enseignant, "[ENSEIGNANT]"]);
    r.enseignant.split(/\s+/).filter((w) => w.length > 2).forEach((w) => pairs.push([w, "[ENSEIGNANT]"]));
  }
  if (e) {
    pairs.push([e.nom, "[ÉCOLE]"]);
    // Nom court de l'école (« Saint-Exupéry », « Gambetta »…), sans les mots génériques.
    const court = e.nom.replace(/^(é|e)cole\s+(maternelle|élémentaire|elementaire|primaire)?\s*(privée?|publique)?\s*(de\s+|d'|du\s+|des\s+)?/i, "").trim();
    if (court.length > 2 && court !== e.nom) pairs.push([court, "[ÉCOLE]"]);
    pairs.push([e.commune, "[COMMUNE]"]);
  }
  (r.masques || "").split(",").map((s) => s.trim()).filter(Boolean).forEach((n, i) => pairs.push([n, `[PERSONNE ${String.fromCharCode(65 + i)}]`]));
  return pairs.sort((a, b) => b[0].length - a[0].length);
}
function masquer(text, pairs) {
  let t = text;
  pairs.forEach(([n, tag]) => {
    const motif = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`(?<!\\p{L})${motif}(?!\\p{L})`, "giu"), tag);
  });
  return t;
}
function retablir(text, r) {
  const e = ecoleDuRdv(r);
  return text
    .replace(/\[ENSEIGNANT\]/g, r.enseignant || "")
    .replace(/l'école \[ÉCOLE\]/gi, ecoleEnTexte(e))
    .replace(/\b(à|de) \[ÉCOLE\]/g, (m, prep) => `${prep} ${ecoleEnTexte(e)}`)
    .replace(/\[ÉCOLE\]/g, ecoleEnTexte(e))
    .replace(/\[COMMUNE\]/g, e ? e.commune : "")
    .replace(/\[PERSONNE ([A-Z])\]/g, (m, l) => ((r.masques || "").split(",").map((s) => s.trim()).filter(Boolean)[l.charCodeAt(0) - 65]) || m);
}
function nettoyerMarkdown(t) {
  return t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,6}\s*/gm, "").replace(/^\s*[-*]\s+/gm, "– ").replace(/\n{3,}/g, "\n\n").trim();
}
function crPrompt(r) {
  const civ = r.civilite || "Madame ou Monsieur";
  const obs = COMPETENCES.map((c, i) => {
    const o = (r.observations || {})[i] || {};
    if (!o.niveau && !o.texte) return "";
    return `${i + 1}. ${c}\n   Positionnement : ${o.niveau || "non précisé"}\n   Mes notes : ${o.texte || "—"}`;
  }).filter(Boolean).join("\n");
  const brut = `Tu es inspectrice de l'Éducation nationale du premier degré. À partir de mes notes d'observation ci-dessous, rédige le compte rendu d'un ${r.type.toLowerCase()} pour ${civ} [ENSEIGNANT], professeur des écoles${r.niveauClasse ? " en " + r.niveauClasse : ""}.

Consignes :
- Suis la grille du référentiel de compétences (PPCR) : pour chaque compétence ci-dessous, rédige un paragraphe de 2 à 4 phrases fondé sur mes notes, en commençant par les points d'appui, puis les pistes de progrès.
- Termine par une partie « Appréciation générale » d'environ 10 lignes, synthétique et bienveillante.
- Style : français administratif soutenu, précis et factuel, à la troisième personne (${civ} [ENSEIGNANT]).
- N'invente aucun fait absent de mes notes.
- Conserve tels quels les marqueurs entre crochets, comme [ENSEIGNANT] ou [ÉCOLE].
- Réponds uniquement avec le compte rendu, en texte brut, sans Markdown ni astérisques.

Séance observée : ${r.seance || "non précisée"}

Mes observations :
${obs || "(aucune compétence renseignée)"}

Mes notes pour l'appréciation générale :
${r.synthese || "—"}`;
  return masquer(brut, crMasques(r));
}
function printText(title, text) {
  const w = window.open("", "_blank");
  if (!w) return toast("Autorisez les fenêtres pop-up pour imprimer");
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>body{font:11.5pt/1.55 -apple-system,"Segoe UI",Calibri,Arial,sans-serif;max-width:720px;margin:40px auto;padding:0 24px;color:#000;white-space:pre-wrap}</style></head>
    <body>${esc(text)}</body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 200);
}

function renderCREditeur(el, id) {
  const r = state.rdv.find((x) => x.id === id);
  if (!r) { el.innerHTML = `<div class="card empty">Ce rendez-vous n'existe plus. <a href="#cr">Retour</a></div>`; return; }
  if (r.uai && !ecoleDuRdv(r) && !renderCREditeur.attente) {
    renderCREditeur.attente = true;
    el.innerHTML = `<div class="card muted">Chargement…</div>`;
    loadEcoles().then(() => { renderCREditeur.attente = false; if (location.hash === "#cr/" + id) route(); });
    return;
  }
  r.observations = r.observations || {};
  const step = renderCREditeur.step?.[id] || (r.crFinal ? 3 : nbCompetences(r) ? 2 : 1);
  const setStep = (n) => { renderCREditeur.step = { ...(renderCREditeur.step || {}), [id]: n }; route(); };
  const etat = crEtat(r);
  $("#viewTitle").textContent = "Compte rendu";

  el.innerHTML = `
  <div class="stack">
    <div class="card no-print">
      <div class="cr-head">
        <a href="#cr" class="btn sm">${icon("back")}Retour</a>
        <div class="avatar">${esc(initials(r.enseignant))}</div>
        <div style="flex:1;min-width:200px">
          <h2 style="font-size:17px">${esc(r.civilite ? r.civilite + " " : "")}${esc(r.enseignant)}</h2>
          <div class="small muted">${esc(r.type)} · ${esc(ecoleLabel(r.uai) || "École non renseignée")}${r.niveauClasse ? " · " + esc(r.niveauClasse) : ""} · ${fmtDate(r.date, { day: "numeric", month: "long", year: "numeric" })}</div>
        </div>
        <span class="badge ${etat === "envoye" ? "ok" : etat === "pret" ? "info" : "warn"}">${{ envoye: "Envoyé", pret: "Prêt", arediger: "À rédiger" }[etat]}</span>
        <button class="btn sm" id="crInfos">Modifier la fiche</button>
      </div>
      <div class="steps" style="margin-top:14px">
        ${["Observation", "Rédaction", "Finalisation"].map((s, i) => `<button class="step ${step === i + 1 ? "active" : ""} ${(i === 0 && nbCompetences(r)) || (i === 1 && r.crFinal) || (i === 2 && etat === "envoye") ? "done" : ""}" data-step="${i + 1}"><span class="n">${(i === 0 && nbCompetences(r)) || (i === 1 && r.crFinal) || (i === 2 && etat === "envoye") ? "✓" : i + 1}</span>${s}</button>`).join("")}
      </div>
    </div>
    <div id="crStep"></div>
  </div>`;
  $$(".step", el).forEach((b) => (b.onclick = () => setStep(+b.dataset.step)));
  $("#crInfos").onclick = () => editRdv(id);
  const box = $("#crStep");

  if (step === 1) {
    box.innerHTML = `
    <div class="card">
      <div class="form-grid" style="margin-bottom:6px">
        <div class="full"><label>Séance observée</label><input id="crSeance" value="${esc(r.seance)}" placeholder="Domaine, objectif, déroulement…"></div>
      </div>
      ${COMPETENCES.map((c, i) => {
        const o = r.observations[i] || {};
        return `<div class="competence">
          <div class="c-title"><span class="c-num">${i + 1}</span>${esc(c)}</div>
          <div class="levels">${NIVEAUX.map((n) => `<label><input type="radio" name="n${i}" value="${n}" ${o.niveau === n ? "checked" : ""}>${n}</label>`).join("")}</div>
          <textarea data-obs="${i}" rows="2" placeholder="Notes rapides : ce que vous avez observé, points d'appui, pistes…">${esc(o.texte)}</textarea>
        </div>`;
      }).join("")}
      <div class="competence"><div class="c-title"><span class="c-num">★</span>Notes pour l'appréciation générale</div><textarea id="synthese" rows="4">${esc(r.synthese)}</textarea></div>
      <div class="row" style="margin-top:12px"><span class="small muted" id="saved">Enregistrement automatique</span><span class="spacer"></span><button class="btn primary" id="next">Continuer vers la rédaction</button></div>
    </div>`;
    const persist = () => {
      COMPETENCES.forEach((_, i) => {
        const niv = $(`input[name="n${i}"]:checked`, box);
        r.observations[i] = { niveau: niv ? niv.value : "", texte: $(`[data-obs="${i}"]`, box).value.trim() };
      });
      r.synthese = $("#synthese").value.trim();
      r.seance = $("#crSeance").value.trim();
      if (r.statut === "Planifié" || r.statut === "À planifier") r.statut = "Réalisé";
      save(); updateCounts();
      $("#saved").textContent = "Enregistré à " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    };
    box.addEventListener("change", persist);
    box.addEventListener("input", () => { clearTimeout(renderCREditeur._t); renderCREditeur._t = setTimeout(persist, 700); });
    $("#next").onclick = () => { persist(); setStep(2); };
    return;
  }

  if (step === 2) {
    const methode = renderCREditeur.methode || "chatgpt";
    const hasKey = !!getApiKey();
    box.innerHTML = `
    <div class="card">
      <div class="method">
        <button data-m="chatgpt" class="${methode === "chatgpt" ? "active" : ""}"><b>ChatGPT</b><span>Gratuit, par copier-coller</span></button>
        <button data-m="claude" class="${methode === "claude" ? "active" : ""}"><b>Claude</b><span>Automatique, avec une clé d'API</span></button>
        <button data-m="sans" class="${methode === "sans" ? "active" : ""}"><b>Sans IA</b><span>Mise en forme de la grille</span></button>
      </div>
      <div id="mBox"></div>
    </div>`;
    $$(".method button", box).forEach((b) => (b.onclick = () => { renderCREditeur.methode = b.dataset.m; route(); }));
    const mBox = $("#mBox");
    const useText = (txt) => {
      r.crFinal = nettoyerMarkdown(retablir(txt, r));
      if (r.statut === "Planifié" || r.statut === "À planifier") r.statut = "Réalisé";
      save(); updateCounts(); setStep(3); toast("Compte rendu prêt à relire");
    };
    const champMasques = `<div style="margin-top:8px"><label>Autres noms à masquer (élèves, collègues…), séparés par des virgules</label><input id="masques" value="${esc(r.masques)}" placeholder="Lucas, Mme Martin…"></div>`;
    const bindMasques = (redraw) => { $("#masques").onchange = (e) => { r.masques = e.target.value; save(); redraw(); }; };

    if (methode === "chatgpt") {
      mBox.innerHTML = `
      <ol class="flow">
        <li><h3>Vérifiez le texte qui sera envoyé</h3>
          <p class="small muted" style="margin:0 0 8px">Le nom de l'enseignant, de l'école et de la commune sont remplacés automatiquement par des marqueurs.</p>
          <div class="output prompt-preview" id="pv"></div>
          ${champMasques}
        </li>
        <li><h3>Copiez, puis collez dans ChatGPT</h3>
          <div class="row"><button class="btn primary" id="go">${icon("copy")}Copier et ouvrir ChatGPT</button>
          <span class="small muted">Dans ChatGPT : Ctrl+V, puis Entrée.</span></div>
        </li>
        <li><h3>Collez ici la réponse de ChatGPT</h3>
          <textarea id="rep" rows="8" placeholder="Copiez la réponse de ChatGPT (bouton « Copier » sous sa réponse), puis collez-la ici."></textarea>
          <div class="row" style="margin-top:8px"><span class="small muted">Les vrais noms seront rétablis automatiquement.</span><span class="spacer"></span><button class="btn primary" id="use">Utiliser ce texte</button></div>
        </li>
      </ol>
      <div class="notice small">Conseil : dans ChatGPT, ouvrez Paramètres → Gestion des données, et désactivez « Améliorer le modèle pour tous » pour que vos textes ne servent pas à l'entraînement.</div>`;
      const draw = () => ($("#pv").textContent = crPrompt(r));
      draw(); bindMasques(draw);
      $("#go").onclick = () => {
        navigator.clipboard.writeText(crPrompt(r)).then(() => {
          toast("Copié : collez-le dans ChatGPT");
          window.open("https://chatgpt.com/", "_blank", "noopener");
        }, () => toast("Copie impossible : sélectionnez le texte à la main"));
      };
      $("#use").onclick = () => { const t = $("#rep").value.trim(); if (!t) return toast("Collez d'abord la réponse"); useText(t); };
    } else if (methode === "claude") {
      mBox.innerHTML = hasKey ? `
        <p class="small muted" style="margin-top:0">Le texte anonymisé ci-dessous est envoyé à Claude, puis le compte rendu revient directement ici, avec les vrais noms rétablis.</p>
        <div class="output prompt-preview" id="pv"></div>
        ${champMasques}
        <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn primary" id="gen">${icon("sparkle")}Rédiger avec Claude</button></div>`
        : `<div class="notice">Cette option nécessite une clé d'API Claude, payante à l'usage (quelques centimes par compte rendu). Vous pouvez la renseigner dans <a href="#parametres">Réglages</a>. Sinon, l'option ChatGPT est gratuite.</div>`;
      if (hasKey) {
        const draw = () => ($("#pv").textContent = crPrompt(r));
        draw(); bindMasques(draw);
        $("#gen").onclick = async () => {
          const b = $("#gen"); b.disabled = true; b.textContent = "Rédaction en cours…";
          try { useText(await askClaude(getApiKey(), "Exécute la demande suivante.", crPrompt(r))); }
          catch (err) { toast("Erreur : " + err.message); b.disabled = false; b.innerHTML = icon("sparkle") + "Rédiger avec Claude"; }
        };
      }
    } else {
      mBox.innerHTML = `
        <p class="small muted" style="margin-top:0">Génère un compte rendu structuré à partir de la grille et de vos notes, sans rien envoyer à l'extérieur. Vous le reformulez ensuite à votre guise.</p>
        <div class="row"><span class="spacer"></span><button class="btn primary" id="gen">Générer depuis la grille</button></div>`;
      $("#gen").onclick = () => useText(compteRendu(r));
    }
    if (r.crFinal) mBox.insertAdjacentHTML("beforeend", `<div class="notice warn small" style="margin-top:12px">Un compte rendu existe déjà : générer un nouveau texte le remplacera. <a href="#" id="toFinal">Voir le texte actuel</a></div>`);
    const tf = $("#toFinal"); if (tf) tf.onclick = (e) => { e.preventDefault(); setStep(3); };
    return;
  }

  // Étape 3 : relecture et export
  box.innerHTML = r.crFinal ? `
    <div class="card">
      <div class="card-head">
        <h2>Relecture</h2>
        <div class="row">
          <span class="small muted" id="saved"></span>
          <button class="btn sm" id="cp">${icon("copy")}Copier</button>
          <button class="btn sm" id="wd">${icon("down")}Word</button>
          <button class="btn sm" id="pr">Imprimer</button>
          ${etat !== "envoye" ? `<button class="btn sm primary" id="sent">Marquer comme envoyé</button>` : `<button class="btn sm" id="unsent">Rouvrir</button>`}
        </div>
      </div>
      <textarea class="editor" id="final">${esc(r.crFinal)}</textarea>
    </div>` : `
    <div class="card"><p class="empty">Aucun texte pour l'instant.</p><button class="btn primary" id="toRed">Aller à la rédaction</button></div>`;
  if (!r.crFinal) { $("#toRed").onclick = () => setStep(2); return; }
  const entete = () => `${r.type}\n${r.civilite ? r.civilite + " " : ""}${r.enseignant} — ${ecoleLabel(r.uai)}\nVisite du ${fmtDate(r.date, { day: "numeric", month: "long", year: "numeric" })}\n\n`;
  $("#final").oninput = (e) => {
    r.crFinal = e.target.value; clearTimeout(renderCREditeur._t);
    renderCREditeur._t = setTimeout(() => { save(); $("#saved").textContent = "Enregistré"; }, 600);
  };
  const fichier = `compte-rendu-${(r.enseignant || "").replace(/\W+/g, "-")}`;
  $("#cp").onclick = () => copy(r.crFinal);
  $("#wd").onclick = () => downloadWord(fichier + ".doc", "Compte rendu", entete() + r.crFinal);
  $("#pr").onclick = () => printText("Compte rendu", entete() + r.crFinal);
  const s = $("#sent"); if (s) s.onclick = () => { save(); r.statut = "Compte rendu envoyé"; save(); updateCounts(); route(); toast("Marqué comme envoyé"); };
  const u = $("#unsent"); if (u) u.onclick = () => { r.statut = "Réalisé"; save(); updateCounts(); route(); };
}

function updateCounts() {
  const today = todayISO();
  const set = (k, n) => { const e = $(`[data-count="${k}"]`); if (e) e.textContent = n || ""; };
  set("courrier", state.courrier.filter((c) => c.statut !== "Traité").length);
  set("rdv", state.rdv.filter((r) => r.date >= today && (r.statut === "Planifié" || r.statut === "À planifier")).length);
  set("cr", crListe().filter((r) => crEtat(r) === "arediger").length);
}

/* ---------- Démarrage ---------- */
function appliquerTheme() { document.documentElement.dataset.theme = state.settings.theme || "light"; }
appliquerTheme();
window.closeModal = closeModal;
loadEcoles().then(() => { if (["accueil", "", "rdv"].includes(location.hash.slice(1))) route(); });
route();
