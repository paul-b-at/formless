import { NextResponse } from "next/server";

export const runtime = "nodejs";

type GeoapifyResult = {
  formatted?: string;
  address_line1?: string;
  street?: string;
  postcode?: string;
  city?: string;
  state?: string;
  country_code?: string;
};

export type AddressSuggestion = {
  label: string;
  address: string;
  zipCode: string;
  city: string;
  stateProvince: string;
  countryCode: string;
};

function toSuggestion(result: GeoapifyResult): AddressSuggestion {
  const address =
    result.address_line1?.trim() || result.street?.trim() || "";
  return {
    label: result.formatted?.trim() || address,
    address,
    zipCode: result.postcode?.trim() ?? "",
    city: result.city?.trim() ?? "",
    stateProvince: result.state?.trim() ?? "",
    countryCode: (result.country_code ?? "").toUpperCase(),
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const text = new URL(request.url).searchParams.get("text")?.trim() ?? "";

  if (text.length < 3) {
    return NextResponse.json({ suggestions: [] satisfies AddressSuggestion[] });
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Address autocomplete is not configured" },
      { status: 503 },
    );
  }

  const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
  url.searchParams.set("text", text);
  url.searchParams.set("format", "json");
  url.searchParams.set("apiKey", apiKey);

  const response = await fetch(url.toString());
  if (!response.ok) {
    const body = await response.text();
    return NextResponse.json(
      { error: "Geoapify request failed", details: body },
      { status: response.status },
    );
  }

  const data = (await response.json()) as { results?: GeoapifyResult[] };
  const suggestions = (data.results ?? [])
    .map(toSuggestion)
    .filter((s) => s.label.length > 0)
    .slice(0, 8);

  return NextResponse.json({ suggestions });
}
