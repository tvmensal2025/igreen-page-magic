/**
 * Troca de titularidade no Portal 2 — só SP.
 * MG (e demais UFs): boleto único sem troca de título.
 */

export function requiresTitleTransfer(uf) {
  const u = String(uf || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return u === "SP" || u === "SAO PAULO";
}

/**
 * @param {object} c customer row
 * @returns {{ contaUnica: boolean, transferirTitularidade: boolean }}
 */
export function resolvePortalContaTitularidade(c) {
  const contaUnica = c?.contaunica_answered === true ? !!c?.contaunica : false;
  const ufOk = requiresTitleTransfer(c?.address_state);

  let wantsTitle;
  if (c?.transferir_titularidade_answered === true) {
    wantsTitle = !!c.transferir_titularidade;
  } else if (c?.contaunica_answered === true) {
    wantsTitle = contaUnica;
  } else {
    wantsTitle = false;
  }

  return {
    contaUnica,
    transferirTitularidade: wantsTitle && ufOk,
  };
}
