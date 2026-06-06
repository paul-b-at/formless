// TODO: implement OCR route — doc upload -> text -> infer destinationCountry/product

import { NextResponse } from "next/server";

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    { error: "OCR route not implemented" },
    { status: 501 },
  );
}
