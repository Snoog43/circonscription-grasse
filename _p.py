p='app.js'; s=open(p,encoding='utf-8').read()
def rep(old,new):
    global s
    assert old in s, old[:90]
    s=s.replace(old,new,1)
# fiche école figée dans le RDV, pour ne pas dépendre du chargement de l'annuaire
rep('''function crMasques(r) {
  const e = ecoleByUai(r.uai);''','''const ecoleDuRdv = (r) => ecoleByUai(r.uai) || (r.ecoleNom ? { nom: r.ecoleNom, commune: r.ecoleCommune || "" } : null);
const ecoleEnTexte = (e) => (e ? "l'" + e.nom.replace(/^[EÉ]cole/, "école") : "l'école");
function crMasques(r) {
  const e = ecoleDuRdv(r);''')
rep('''function retablir(text, r) {
  const e = ecoleByUai(r.uai);
  return text
    .replace(/\[ÉCOLE\]/g, e ? e.nom : "l'école")''','''function retablir(text, r) {
  const e = ecoleDuRdv(r);
  return text
    .replace(/\b(à|a) \[ÉCOLE\]/g, "à " + ecoleEnTexte(e))
    .replace(/\b(de|De) \[ÉCOLE\]/g, "$1 " + ecoleEnTexte(e))
    .replace(/\[ÉCOLE\]/g, ecoleEnTexte(e))''')
rep('''function renderCREditeur(el, id) {
  const r = state.rdv.find((x) => x.id === id);''','''function renderCREditeur(el, id) {
  const r = state.rdv.find((x) => x.id === id);
  // L'annuaire doit être chargé pour masquer correctement le nom de l'école.
  if (r && r.uai && !ecoleDuRdv(r) && !renderCREditeur.attente) {
    renderCREditeur.attente = true;
    el.innerHTML = `<div class="card muted">Chargement…</div>`;
    loadEcoles().then(() => { renderCREditeur.attente = false; if (location.hash === "#cr/" + id) route(); });
    return;
  }''')
rep('''      const d = formData(f);
      let created = null;''','''      const d = formData(f);
      const ec = ecoleByUai(d.uai);
      if (ec) { d.ecoleNom = ec.nom; d.ecoleCommune = ec.commune; }
      let created = null;''')
open(p,'w',encoding='utf-8').write(s); print('ok')
