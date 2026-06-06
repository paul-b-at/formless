import {
  AppointmentRequest,
  type AppointmentRequest as AppointmentRequestType,
} from "./booking-schema";

const BASE_URL =
  process.env.NOTARITY_API_BASE ?? "https://staging-api.notarity.com";

const DEFAULT_HEADERS = {
  accept: "application/json, text/plain, */*",
  referer: "https://staging.notarity.com/",
} as const;

export type PriceLineItem = {
  name: string;
  _product?: string;
  amount: number;
  pricePerUnit: number;
  net: number;
  identifier: number;
  pricingEnabled?: boolean;
};

export type BookingFormSchema = Record<string, unknown>;

export type Product = Record<string, unknown>;

export type Timeslot = {
  id: string;
  startTime: string;
  endTime: string;
  available: number;
  taken: number;
  _timeslotLabel: string;
  deleted: boolean;
};

type UploadedFile = {
  name: string;
  data: Blob | Buffer;
};

async function notarityFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, init);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Notarity API error ${response.status} ${response.statusText}: ${text}`,
    );
  }

  return response.json() as Promise<T>;
}

export async function getBookingForm(slug: string): Promise<BookingFormSchema> {
  const params = new URLSearchParams({ slug });
  return notarityFetch<BookingFormSchema>(`/booking-form/slug?${params}`);
}

export async function getProductsByTags(tags: string[]): Promise<Product[]> {
  const params = new URLSearchParams();
  for (const tag of tags) {
    params.append("_tags", tag);
  }
  return notarityFetch<Product[]>(`/products/tags?${params}`);
}

export async function getTimeslots(args: {
  timeslotLabel: string;
  startDate: string;
  endDate: string;
}): Promise<Timeslot[]> {
  const params = new URLSearchParams({
    _timeslotLabel: args.timeslotLabel,
    startDate: args.startDate,
    endDate: args.endDate,
  });
  return notarityFetch<Timeslot[]>(
    `/appointment-requests/timeslots?${params}`,
  );
}

export async function priceRequest(
  payload: AppointmentRequestType,
): Promise<PriceLineItem[]> {
  const validated = AppointmentRequest.parse(payload);

  return notarityFetch<PriceLineItem[]>("/appointment-requests/price", {
    method: "POST",
    headers: {
      ...DEFAULT_HEADERS,
      "content-type": "application/json",
      origin: "https://staging.notarity.com",
      "cache-control": "no-cache",
    },
    body: JSON.stringify(validated),
  });
}

export function sumNetToEuros(lineItems: PriceLineItem[]): number {
  const totalCents = lineItems.reduce((sum, item) => sum + item.net, 0);
  return totalCents / 100;
}

function toBlob(data: Blob | Buffer): Blob {
  if (data instanceof Blob) {
    return data;
  }
  return new Blob([new Uint8Array(data)], { type: "application/pdf" });
}

function validateFileNames(
  payload: AppointmentRequestType,
  files: UploadedFile[],
): void {
  const uploadedNames = new Set(files.map((file) => file.name));

  for (const product of payload.products) {
    for (const fileName of product.files) {
      if (!uploadedNames.has(fileName)) {
        throw new Error(
          `Missing uploaded file for products[].files entry: "${fileName}"`,
        );
      }
    }
  }
}

export async function submitRequest(
  payload: AppointmentRequestType,
  files: UploadedFile[],
): Promise<unknown> {
  const validated = AppointmentRequest.parse(payload);
  validateFileNames(validated, files);

  const form = new FormData();

  for (const file of files) {
    const blob = toBlob(file.data);
    form.append(
      "files",
      new File([blob], file.name, { type: "application/pdf" }),
    );
  }

  form.append("payload", JSON.stringify(validated));

  const response = await fetch(`${BASE_URL}/appointment-requests`, {
    method: "POST",
    headers: {
      ...DEFAULT_HEADERS,
      "accept-language": "en-AT,en;q=0.9",
      "cache-control": "no-cache",
    },
    body: form,
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Notarity submit error ${response.status} ${response.statusText}: ${text}`,
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
