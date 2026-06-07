import { describe, expect, test } from "bun:test";

import {
  applyParticipantsChatAction,
  findParticipantsComponent,
  getParticipantSetup,
  isParticipantsFilled,
  mergeParticipantRows,
  parseParticipantsChatMessage,
  parseParticipantsStructuredAnswer,
  stripParticipantMeta,
  validateParticipantRows,
} from "../participant-config";
import type { BookingFormSchema } from "../form-interpreter";

const form: BookingFormSchema = {
  id: "form-1",
  pages: [
    {
      components: [
        { id: "p1", type: "participants", accessor: "participants", props: {} },
      ],
    },
  ],
};

const formWithLimits: BookingFormSchema = {
  id: "form-2",
  pages: [
    {
      components: [
        {
          id: "p1",
          type: "participants",
          accessor: "participants",
          props: { minParticipants: 2, maxParticipants: 4 },
        },
      ],
    },
  ],
};

describe("participant-config", () => {
  test("findParticipantsComponent locates participants component", () => {
    const component = findParticipantsComponent(form);
    expect(component?.accessor).toBe("participants");
  });

  test("getParticipantSetup applies defaults for empty props", () => {
    const component = findParticipantsComponent(form)!;
    const setup = getParticipantSetup(component);
    expect(setup.minParticipants).toBe(1);
    expect(setup.maxParticipants).toBe(10);
  });

  test("getParticipantSetup reads min/max props", () => {
    const component = findParticipantsComponent(formWithLimits)!;
    const setup = getParticipantSetup(component);
    expect(setup.minParticipants).toBe(2);
    expect(setup.maxParticipants).toBe(4);
  });

  test("single chat email auto-finalizes when min is 1", () => {
    const component = findParticipantsComponent(form)!;
    const setup = getParticipantSetup(component);
    const collected = {
      participants: [
        { email: "joshua.timms@notarity.com", client: true, supervisor: false },
      ],
    };
    expect(isParticipantsFilled(collected, setup)).toBe(true);
  });

  test("expectMore keeps participants unfilled", () => {
    const component = findParticipantsComponent(form)!;
    const setup = getParticipantSetup(component);
    const collected = {
      participants: [
        { email: "signer1@test.com", client: true, supervisor: false },
      ],
      participantsExpectMore: true,
    };
    expect(isParticipantsFilled(collected, setup)).toBe(false);
  });

  test("finalize requires min participants", () => {
    const component = findParticipantsComponent(formWithLimits)!;
    const setup = getParticipantSetup(component);
    const oneSigner = {
      participants: [
        { email: "signer1@test.com", client: true, supervisor: false },
      ],
      participantsFinalized: true,
    };
    expect(isParticipantsFilled(oneSigner, setup)).toBe(false);

    const twoSigners = {
      participants: [
        { email: "signer1@test.com", client: true, supervisor: false },
        { email: "signer2@test.com", client: true, supervisor: false },
      ],
      participantsFinalized: true,
    };
    expect(isParticipantsFilled(twoSigners, setup)).toBe(true);
  });

  test("mergeParticipantRows deduplicates by email", () => {
    const merged = mergeParticipantRows(
      [{ email: "a@test.com", client: true, supervisor: false }],
      [{ email: "A@test.com", client: true, supervisor: false }],
    );
    expect(merged).toHaveLength(1);
  });

  test("parseParticipantsChatMessage handles continue and append", () => {
    expect(parseParticipantsChatMessage("continue")?.type).toBe("finalize");
    expect(parseParticipantsChatMessage("add another signer")?.type).toBe(
      "expectMore",
    );
    expect(parseParticipantsChatMessage("signer1@test.com")?.type).toBe(
      "append",
    );
  });

  test("parseParticipantsStructuredAnswer finalizes on continue", () => {
    const component = findParticipantsComponent(formWithLimits)!;
    const setup = getParticipantSetup(component);
    const parsed = parseParticipantsStructuredAnswer(
      {
        participants: [
          { email: "signer1@test.com", client: true, supervisor: false },
          { email: "signer2@test.com", client: true, supervisor: false },
        ],
        finalize: true,
      },
      [],
      setup,
    );
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.finalized).toBe(true);
    expect(parsed.expectMore).toBe(false);
  });

  test("validateParticipantRows rejects duplicate emails", () => {
    const component = findParticipantsComponent(form)!;
    const setup = getParticipantSetup(component);
    const result = validateParticipantRows(
      [
        { email: "same@test.com", client: true, supervisor: false },
        { email: "same@test.com", client: true, supervisor: false },
      ],
      setup,
    );
    expect(result.ok).toBe(false);
  });

  test("applyParticipantsChatAction appends email", () => {
    const component = findParticipantsComponent(form)!;
    const setup = getParticipantSetup(component);
    const next = applyParticipantsChatAction(
      { participants: [] },
      { type: "append", email: "signer1@test.com" },
      setup,
    );
    expect(next.participants).toHaveLength(1);
    expect(next.participants?.[0]?.email).toBe("signer1@test.com");
  });

  test("stripParticipantMeta removes internal flags", () => {
    const stripped = stripParticipantMeta({
      participants: [
        { email: "a@test.com", client: true, supervisor: false },
      ],
      participantsExpectMore: true,
      participantsFinalized: true,
    });
    expect(stripped.participantsExpectMore).toBeUndefined();
    expect(stripped.participantsFinalized).toBeUndefined();
    expect(stripped.participants).toHaveLength(1);
  });
});
