import { useMemo, useState } from 'react';

/**
 * État partagé des tableaux d'administration : tri, pagination et sélection
 * multiple. Le filtrage reste côté API, seul le classement local est traité ici.
 */
export function useDataTable(rows = [], { pageSize = 20, initialSort = null } = {}) {
  const [sort, setSort] = useState(initialSort);
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState([]);

  const triees = useMemo(() => {
    if (!sort?.key) return rows;
    const sens = sort.direction === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sens;
      // Les dates avant le repli textuel. `String(new Date(...))` donne
      // « Tue Sep 01 2026 … » : comparées ainsi, les lignes se rangeaient par
      // nom de jour de la semaine, puis par mois en anglais. La colonne
      // « Créneau » de l'administration triait donc faux depuis toujours, et
      // le désordre passait inaperçu parce que le premier écran restait
      // plausible.
      if (va instanceof Date && vb instanceof Date) return (va - vb) * sens;
      return String(va).localeCompare(String(vb), 'fr') * sens;
    });
  }, [rows, sort]);

  const pageCount = Math.max(1, Math.ceil(triees.length / pageSize));
  const pageCourante = Math.min(page, pageCount);
  const visibles = triees.slice((pageCourante - 1) * pageSize, pageCourante * pageSize);

  const basculerTri = (key) =>
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' },
    );

  const basculerLigne = (id) =>
    setSelection((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  // La sélection globale ne porte que sur la page affichée : cocher l'en-tête
  // ne doit pas embarquer silencieusement 1 800 lignes invisibles.
  const idsPage = visibles.map((row) => row.id);
  const toutesSelectionnees = idsPage.length > 0 && idsPage.every((id) => selection.includes(id));
  const basculerPage = () =>
    setSelection((current) =>
      toutesSelectionnees
        ? current.filter((id) => !idsPage.includes(id))
        : [...new Set([...current, ...idsPage])],
    );

  return {
    rows: visibles,
    total: triees.length,
    page: pageCourante,
    pageCount,
    pageSize,
    setPage,
    sort,
    basculerTri,
    selection,
    basculerLigne,
    basculerPage,
    toutesSelectionnees,
    viderSelection: () => setSelection([]),
  };
}
