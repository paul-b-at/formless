"use client";

import { useMemo, useState } from "react";

import { countryFlag } from "@/components/country-display";
import type { CountryOption } from "@/lib/form-interpreter";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type CountrySearchSelectProps = {
  countries: CountryOption[];
  loading?: boolean;
  onSelect: (country: CountryOption) => void;
  className?: string;
};

export function CountrySearchSelect({
  countries,
  loading = false,
  onSelect,
  className,
}: CountrySearchSelectProps): React.ReactElement {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return countries;
    }
    return countries.filter(
      (country) =>
        country.label.toLowerCase().includes(normalized) ||
        country.code.toLowerCase().includes(normalized),
    );
  }, [countries, query]);

  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">
          Choose destination country
        </p>
        <p className="text-xs text-muted-foreground">
          Search by country name or ISO code — sourced from the live booking
          form.
        </p>
      </div>

      <div className="flex min-h-9 w-full items-center border-b border-input">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search countries…"
          disabled={loading}
          aria-label="Search destination countries"
          className="h-auto min-h-9 flex-1 rounded-none border-0 bg-transparent px-0 py-2 text-sm leading-normal shadow-none focus-visible:ring-0 [appearance:textfield] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden [&::-webkit-search-results-button]:hidden"
        />
      </div>

      <ScrollArea className="h-48 w-full rounded-xl border border-border/60 bg-muted/30">
        <ul className="p-1" role="listbox" aria-label="Destination countries">
          {filtered.length === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-muted-foreground">
              No countries match your search.
            </li>
          ) : (
            filtered.map((country) => {
              const flag = countryFlag(country.code);
              return (
                <li key={country.code} role="presentation">
                  <button
                    type="button"
                    role="option"
                    disabled={loading}
                    className="flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-primary/8 focus-visible:bg-primary/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50"
                    onClick={() => onSelect(country)}
                  >
                    {flag ? (
                      <span className="text-base leading-none" aria-hidden>
                        {flag}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">
                      {country.label}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {country.code}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </ScrollArea>
    </div>
  );
}
