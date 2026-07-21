/**
 * Troca de titularidade no Portal 2 — só SP.
 * MG (e demais UFs): boleto único sem troca de título.
 * Cliente não vê pergunta; só o flag no payload do cadastro.
 */

export function requiresTitleTransfer(uf: string | null | undefined): boolean {
  const u = String(uf || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return u === "SP" || u === "SAO PAULO";
}

export type TitularidadeCustomerFlags = {
  address_state?: string | null;
  contaunica?: boolean | null;
  contaunica_answered?: boolean | null;
  transferir_titularidade?: boolean | null;
  transferir_titularidade_answered?: boolean | null;
};

/**
 * contaUnica = preferência de cobrança (boleto único).
 * transferirTitularidade = só se UF exigir (SP) e boleto/título indicar sim.
 */
export function resolvePortalContaTitularidade(c: TitularidadeCustomerFlags): {
  contaUnica: boolean;
  transferirTitularidade: boolean;
} {
  const contaUnica = c.contaunica_answered === true ? !!c.contaunica : false;
  const ufOk = requiresTitleTransfer(c.address_state);

  let wantsTitle: boolean;
  if (c.transferir_titularidade_answered === true) {
    wantsTitle = !!c.transferir_titularidade;
  } else if (c.contaunica_answered === true) {
    // Sofia / Grupo A: boleto único implícito ⇔ título só onde a UF exige
    wantsTitle = contaUnica;
  } else {
    wantsTitle = false;
  }

  return {
    contaUnica,
    transferirTitularidade: wantsTitle && ufOk,
  };
}
