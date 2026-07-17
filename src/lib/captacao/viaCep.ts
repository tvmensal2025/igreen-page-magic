/** ViaCEP — mesmo padrão de AddCustomerDialog / CustomerEditDialog. */

export type ViaCepAddress = {
  cep: string;
  address_street: string;
  address_neighborhood: string;
  address_city: string;
  address_state: string;
};

export async function lookupViaCep(cepRaw: string): Promise<ViaCepAddress | null> {
  const cep = String(cepRaw || "").replace(/\D/g, "");
  if (cep.length !== 8) return null;
  const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || data.erro) return null;
  return {
    cep,
    address_street: String(data.logradouro || "").trim(),
    address_neighborhood: String(data.bairro || "").trim(),
    address_city: String(data.localidade || "").trim(),
    address_state: String(data.uf || "").trim().toUpperCase(),
  };
}
