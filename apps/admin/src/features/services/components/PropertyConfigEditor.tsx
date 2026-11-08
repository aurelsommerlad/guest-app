"use client";

import { BOOKING_RULES, type LocalizedText } from "@up/core";
import { Button } from "@up/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { Field, FormMessage, Input, LocalizedPair, Select } from "../../../components/fields";
import type { ServiceFormState } from "../actions";
import type { ApaleoServiceOption, ApaleoUnitGroupOption } from "../apaleo-source";
import { BOOKING_RULE_LABELS } from "../labels";
import { FormSection } from "./OfferEditor";

export type ConfigEditorValues = {
  extrasServiceId: string | null;
  active: boolean;
  sortOrder: number;
  actionType: string | null;
  bookingRule: string | null;
  fulfillment: string | null;
  extraPersonPriceCents: number | null;
  priceUnitLabel: LocalizedText | null;
  requiresRemainingCapacity: boolean;
  requiresVehicleRegistration: boolean;
  maxOnePerReservation: boolean;
  allowedUnitGroupIds: string[];
  titleOverride: LocalizedText | null;
  teaserOverride: LocalizedText | null;
};

export type ApaleoChoice =
  | {
      available: true;
      source: "apaleo" | "fixture";
      services: ApaleoServiceOption[];
      unitGroups: ApaleoUnitGroupOption[];
      apaleoPropertyId: string;
    }
  | {
      available: false;
      reason: "not-configured" | "not-mapped" | "error";
      apaleoPropertyId?: string;
    };

const APALEO_NOTE: Record<"not-configured" | "not-mapped" | "error", string> = {
  "not-configured":
    "Apaleo ist in dieser Umgebung nicht verbunden – Service-ID bitte von Hand eintragen.",
  "not-mapped": "Dieses Objekt ist keinem Apaleo-Objekt zugeordnet.",
  error: "Die Apaleo-Services konnten gerade nicht geladen werden – Service-ID von Hand eintragen.",
};

function Toggle({
  name,
  label,
  hint,
  defaultChecked,
  checked,
  disabled,
  onChange,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-start gap-3">
      <input
        type="checkbox"
        name={name}
        className="mt-1 size-4"
        {...(checked === undefined ? { defaultChecked } : { checked })}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
      />
      <span className="flex flex-col">
        <span className="type-body text-text">{label}</span>
        {hint && <span className="type-caption text-text-muted">{hint}</span>}
      </span>
    </label>
  );
}

const formatCents = (cents: number | null) =>
  cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",").replace(",00", "");

/** Configuration of one offer at one property – every field of the Extras catalog. */
export function PropertyConfigEditor({
  values,
  apaleo,
  action,
  readOnly,
  submitLabel,
}: {
  values: ConfigEditorValues;
  apaleo: ApaleoChoice;
  action: (previous: ServiceFormState, formData: FormData) => Promise<ServiceFormState>;
  readOnly: boolean;
  submitLabel: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const [actionType, setActionType] = useState(values.actionType ?? "service");
  const [serviceId, setServiceId] = useState(values.extrasServiceId ?? "");
  const isOccupancy = actionType === "increase_occupancy";
  useEffect(() => {
    if (state.status === "created") router.push(state.url);
  }, [state, router]);
  const selected = apaleo.available ? apaleo.services.find((s) => s.id === serviceId) : undefined;
  const knownService = !apaleo.available || !serviceId || selected !== undefined;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <fieldset disabled={readOnly} className="flex flex-col gap-6">
        <FormSection
          id="config-apaleo"
          title="Apaleo-Service"
          description="Welcher Apaleo-Service an diesem Objekt gebucht wird. Preise kommen live aus Apaleo."
        >
          {apaleo.available ? (
            <Field
              label="Service"
              htmlFor="config-service"
              hint={
                apaleo.source === "fixture"
                  ? "Testdaten (nur lokale Entwicklung)."
                  : `Apaleo-Objekt ${apaleo.apaleoPropertyId}`
              }
            >
              <Select
                id="config-service"
                name="extrasServiceId"
                value={serviceId}
                onChange={(event) => {
                  setServiceId(event.target.value);
                }}
              >
                <option value="">– kein Service –</option>
                {!knownService && (
                  <option value={serviceId}>{serviceId} (nicht in Apaleo gefunden)</option>
                )}
                {apaleo.services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} · {service.id}
                    {service.mode ? ` · ${service.mode}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <>
              <p className="type-small text-text-muted">{APALEO_NOTE[apaleo.reason]}</p>
              <Field label="Apaleo-Service-ID" htmlFor="config-service">
                <Input
                  id="config-service"
                  name="extrasServiceId"
                  defaultValue={values.extrasServiceId ?? ""}
                  pattern="[A-Za-z0-9_\-]{1,120}"
                  placeholder="z. B. ALTUS-LCO"
                />
              </Field>
            </>
          )}
          {selected?.defaultGrossPrice && (
            <p className="type-small text-text-muted">
              Listenpreis in Apaleo:{" "}
              {selected.defaultGrossPrice.amount.toFixed(2).replace(".", ",")}{" "}
              {selected.defaultGrossPrice.currency}. Gäste sehen den Live-Preis ihrer Reservierung.
            </p>
          )}
          {!knownService && (
            <p role="status" className="type-small text-text">
              Die gespeicherte Service-ID gibt es in Apaleo nicht (mehr). Bitte prüfen.
            </p>
          )}
        </FormSection>

        <FormSection id="config-booking" title="Buchung und Preis">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Aktion" htmlFor="config-action">
              <Select
                id="config-action"
                name="actionType"
                value={actionType}
                onChange={(event) => {
                  setActionType(event.target.value);
                }}
              >
                <option value="service">Apaleo-Service buchen</option>
                <option value="increase_occupancy">Zusatzperson (Belegung erhöhen)</option>
              </Select>
            </Field>
            <Field label="Buchungsregel" htmlFor="config-rule">
              <Select
                id="config-rule"
                name="bookingRule"
                defaultValue={values.bookingRule ?? "per_stay"}
              >
                {BOOKING_RULES.map((rule) => (
                  <option key={rule} value={rule}>
                    {BOOKING_RULE_LABELS[rule]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Buchungsart"
              htmlFor="config-fulfillment"
              hint={isOccupancy ? "Zusatzpersonen werden immer sofort gebucht." : undefined}
            >
              <Select
                id="config-fulfillment"
                name="fulfillment"
                defaultValue={isOccupancy ? "instant" : (values.fulfillment ?? "instant")}
                disabled={isOccupancy}
              >
                <option value="instant">Sofort buchbar</option>
                <option value="request">Auf Anfrage (Freigabe im Admin)</option>
              </Select>
            </Field>
            {isOccupancy && (
              <Field
                label="Preis pro Person und Nacht (EUR)"
                htmlFor="config-price"
                hint="Ohne Preis ist die Zusatzperson nicht buchbar – sie wird nie kostenlos gebucht."
              >
                <Input
                  id="config-price"
                  name="extraPersonPrice"
                  inputMode="decimal"
                  defaultValue={formatCents(values.extraPersonPriceCents)}
                  placeholder="z. B. 35"
                />
              </Field>
            )}
          </div>
          <LocalizedPair label="Preiseinheit (optional, sonst nach Buchungsregel)">
            <Input
              name="priceUnitLabelDe"
              aria-label="Preiseinheit Deutsch"
              defaultValue={values.priceUnitLabel?.de}
              maxLength={60}
              placeholder="z. B. pro Nacht"
            />
            <Input
              name="priceUnitLabelEn"
              aria-label="Preiseinheit Englisch"
              defaultValue={values.priceUnitLabel?.en}
              maxLength={60}
              placeholder="per night"
            />
          </LocalizedPair>
        </FormSection>

        <FormSection id="config-rules" title="Regeln und Beschränkungen">
          <Toggle
            name="requiresRemainingCapacity"
            label="Nur bei freier Kapazität anbieten"
            hint="Ausblenden, wenn der Apartmenttyp voll belegt ist."
            {...(isOccupancy
              ? { checked: true, disabled: true }
              : { defaultChecked: values.requiresRemainingCapacity })}
          />
          {isOccupancy && <input type="hidden" name="requiresRemainingCapacity" value="on" />}
          <Toggle
            name="maxOnePerReservation"
            label="Höchstens einmal pro Reservierung"
            hint="z. B. Hund – wird vor jeder Buchung live geprüft."
            defaultChecked={values.maxOnePerReservation}
          />
          <Toggle
            name="requiresVehicleRegistration"
            label="Kennzeichen erforderlich"
            hint="Der Gast gibt je Fahrzeug ein Kennzeichen ein (z. B. Parkplatz)."
            defaultChecked={values.requiresVehicleRegistration}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="type-eyebrow pb-1.5 text-text">Apartmenttypen</legend>
            {apaleo.available && apaleo.unitGroups.length > 0 ? (
              <div className="grid gap-1 sm:grid-cols-2">
                {apaleo.unitGroups.map((group) => (
                  <label key={group.id} className="type-body flex min-h-11 items-center gap-3">
                    <input
                      type="checkbox"
                      name="allowedUnitGroupIds"
                      value={group.id}
                      defaultChecked={values.allowedUnitGroupIds.includes(group.id)}
                    />
                    {group.name}
                    {group.maxPersons ? ` (bis ${group.maxPersons} Pers.)` : ""}
                  </label>
                ))}
                {values.allowedUnitGroupIds
                  .filter((id) => !apaleo.unitGroups.some((g) => g.id === id))
                  .map((id) => (
                    <label key={id} className="type-body flex min-h-11 items-center gap-3">
                      <input type="checkbox" name="allowedUnitGroupIds" value={id} defaultChecked />
                      {id} (nicht in Apaleo gefunden)
                    </label>
                  ))}
              </div>
            ) : (
              <Input
                name="allowedUnitGroupIdsText"
                aria-label="Apartmenttypen (Apaleo-IDs, kommagetrennt)"
                defaultValue={values.allowedUnitGroupIds.join(", ")}
                placeholder="leer = alle Apartmenttypen"
              />
            )}
            <p className="type-caption text-text-muted">Keine Auswahl = für alle Apartmenttypen.</p>
          </fieldset>
        </FormSection>

        <FormSection id="config-visibility" title="Sichtbarkeit und Texte an diesem Objekt">
          <Toggle
            name="active"
            label="Gästen an diesem Objekt anzeigen"
            defaultChecked={values.active}
          />
          <Field label="Reihenfolge" htmlFor="config-sort" hint="Kleinere Zahlen zuerst.">
            <Input
              id="config-sort"
              name="sortOrder"
              type="number"
              min={0}
              max={9999}
              defaultValue={values.sortOrder}
              className="max-w-40"
            />
          </Field>
          <LocalizedPair label="Abweichender Titel (optional)">
            <Input
              name="titleOverrideDe"
              aria-label="Abweichender Titel Deutsch"
              defaultValue={values.titleOverride?.de}
              maxLength={120}
            />
            <Input
              name="titleOverrideEn"
              aria-label="Abweichender Titel Englisch"
              defaultValue={values.titleOverride?.en}
              maxLength={120}
              placeholder="English"
            />
          </LocalizedPair>
          <LocalizedPair label="Abweichende Kurzbeschreibung (optional)">
            <Input
              name="teaserOverrideDe"
              aria-label="Abweichende Kurzbeschreibung Deutsch"
              defaultValue={values.teaserOverride?.de}
              maxLength={220}
            />
            <Input
              name="teaserOverrideEn"
              aria-label="Abweichende Kurzbeschreibung Englisch"
              defaultValue={values.teaserOverride?.en}
              maxLength={220}
              placeholder="English"
            />
          </LocalizedPair>
        </FormSection>
      </fieldset>
      {state.status !== "created" && <FormMessage state={state} />}
      {state.status === "saved" && state.issues && state.issues.length > 0 && (
        <ul className="type-small list-disc pl-5 text-text">
          {state.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Speichern …" : submitLabel}
        </Button>
      )}
    </form>
  );
}
