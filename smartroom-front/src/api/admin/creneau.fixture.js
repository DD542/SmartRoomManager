// Créneau tel que l'API le sérialise : `starts_at` / `ends_at`, jamais
// `start` / `end`. Les seconds sont les noms *rendus* aux écrans par
// `slotOut` ; les confondre dans un aiguillage de test produit un `null`
// silencieux au lieu d'une date, et le test échoue loin de sa cause.
export const creneau = (debut, fin) => ({
  starts_at: debut,
  ends_at: fin,
  duration_minutes: Math.round((new Date(fin) - new Date(debut)) / 60000),
  local_label: 'créneau de test',
});
