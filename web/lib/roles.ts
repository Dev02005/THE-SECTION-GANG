import type { Department, PlanPayload } from "./plan";
import {
  ALL_DIVISIONS,
  type Division,
  REFERENCE_DIVISION,
  REFERENCE_ZONE,
  type Zone,
  ZONES,
} from "./railways";

/**
 * Demonstration sign-in across the whole of Indian Railways.
 *
 * These are NOT credentials and this is NOT authentication. A deployed
 * instance would carry no user table at all: every officer below already has
 * an HRMS employee ID, and an internal application on RailNet authenticates
 * against that directory. A block plan is an auditable document - "approved by
 * Sr.DEN" has to resolve to a real establishment record, not a row somebody
 * typed into our database. Local accounts would also go stale the moment an
 * officer is transferred, which on Indian Railways is constantly.
 *
 * What this exists for is to show the SHAPE of the deployment: which posts
 * hold an account, at which level, and how few of them there are. Five people
 * decide a division; five run a zone. Across all of Indian Railways that is
 * 425 accounts for 68 divisions - fewer than most people expect, and the point
 * the page makes.
 *
 * Only Waltair has a solved plan in this instance. Every other division
 * resolves to a real post with no plan behind it, and the app says so rather
 * than showing Waltair's numbers under another division's name.
 *
 * The passwords are printed on the sign-in page on purpose.
 */

export type Level = "zone" | "division";

export interface Role {
  userId: string;
  password: string;
  designation: string;
  full: string;
  /** The maintenance department whose register this officer owns, if any. */
  department: Department | null;
  remit: string;
  level: Level;
  zone: Zone;
  /** null for zonal posts. */
  division: Division | null;
  /** Whether this instance holds a solved plan for this officer's division. */
  hasPlan: boolean;
}

/**
 * The one demonstration password, shared by every post and printed on the
 * sign-in page. Exported because `PasswordSettings` needs it to put it back
 * after a change, and a second copy of a literal kept in step by hand is the
 * drift bug this project has been bitten by four times.
 *
 * It is also written into `0005_credentials.sql` and `0009_password.sql`,
 * which cannot import from here. That copy is the seed; this one is the app.
 */
export const DEMO_PASSWORD = "block@2026";
const PASSWORD = DEMO_PASSWORD;

interface PostSpec {
  post: string;
  designation: string;
  full: string;
  department: Department | null;
  remit: string;
}

/** The five divisional posts - the block meeting. */
const DIVISIONAL: readonly PostSpec[] = [
  {
    post: "SrDEN",
    designation: "Sr.DEN",
    full: "Sr. Divisional Engineer",
    department: "ENGG",
    remit: "Permanent way. Owns the track defect register (TMS).",
  },
  {
    post: "SrDSTE",
    designation: "Sr.DSTE",
    full: "Sr. Divisional Signal & Telecom Engineer",
    department: "SNT",
    remit: "Signalling and telecom. Owns the S&T register (SMMS).",
  },
  {
    post: "SrDEE",
    designation: "Sr.DEE",
    full: "Sr. Divisional Electrical Engineer",
    department: "TRD",
    remit: "Traction distribution and OHE. Owns the TRD register (TDMS).",
  },
  {
    post: "SrDOM",
    designation: "Sr.DOM",
    full: "Sr. Divisional Operations Manager",
    department: null,
    remit: "Train movement. Owns the detention cost the plan spends.",
  },
  {
    post: "DRM",
    designation: "DRM",
    full: "Divisional Railway Manager",
    department: null,
    remit: "Chairs the block meeting. Approves the programme.",
  },
] as const;

/**
 * The five zonal posts - the same five functions one level up.
 *
 * A zone does not schedule blocks. It allocates the scarce machines that make
 * scheduling possible: the tamper, the tower wagon and the USFD units are
 * zonal assets handed to divisions for a season. That allocation is what
 * decouples the divisions from one another, which is why the zone is the
 * correct place to split this problem and the section is not.
 */
const ZONAL: readonly PostSpec[] = [
  {
    post: "PCE",
    designation: "PCE",
    full: "Principal Chief Engineer",
    department: "ENGG",
    remit: "Track policy and P.Way machine allocation across divisions.",
  },
  {
    post: "PCSTE",
    designation: "PCSTE",
    full: "Principal Chief Signal & Telecom Engineer",
    department: "SNT",
    remit: "S&T policy and works programme across divisions.",
  },
  {
    post: "PCEE",
    designation: "PCEE",
    full: "Principal Chief Electrical Engineer",
    department: "TRD",
    remit: "Traction policy and tower wagon allocation across divisions.",
  },
  {
    post: "PCOM",
    designation: "PCOM",
    full: "Principal Chief Operations Manager",
    department: null,
    remit: "Zonal train movement. Sanctions traffic blocks of consequence.",
  },
  {
    post: "GM",
    designation: "GM",
    full: "General Manager",
    department: null,
    remit: "Heads the zone. Answers to the Railway Board.",
  },
] as const;

function buildRoles(): Role[] {
  const out: Role[] = [];
  for (const zone of ZONES) {
    for (const s of ZONAL) {
      out.push({
        userId: s.post + "/" + zone.code,
        password: PASSWORD,
        designation: s.designation,
        full: s.full,
        department: s.department,
        remit: s.remit,
        level: "zone",
        zone,
        division: null,
        hasPlan: zone.code === REFERENCE_ZONE,
      });
    }
    for (const division of zone.divisions) {
      for (const s of DIVISIONAL) {
        out.push({
          userId: s.post + "/" + zone.code + "/" + division.code,
          password: PASSWORD,
          designation: s.designation,
          full: s.full,
          department: s.department,
          remit: s.remit,
          level: "division",
          zone,
          division,
          hasPlan:
            zone.code === REFERENCE_ZONE &&
            division.code === REFERENCE_DIVISION,
        });
      }
    }
  }
  return out;
}

export const ROLES: readonly Role[] = buildRoles();
export const DIVISION =
  (ALL_DIVISIONS.find((d) => d.code === REFERENCE_DIVISION)?.name ??
    "Waltair") +
  " (" +
  REFERENCE_DIVISION +
  ")";

export function rolesFor(zone: string, division: string | null): Role[] {
  return ROLES.filter(
    (r) =>
      r.zone.code === zone &&
      (division === null ? r.level === "zone" : r.division?.code === division),
  );
}
export function roleById(userId: string | null): Role | null {
  if (userId === null) return null;
  return ROLES.find((r) => r.userId === userId) ?? null;
}
export interface DeptSummary {
  department: Department;
  total: number;
  scheduled: number;
  scheduledBaseline: number;
  deferred: number;
  blocks: number;
  sharedBlocks: number;
  statutoryTotal: number;
  statutoryDone: number;
  statutoryBaseline: number;
  deferredIds: string[];
}

export function departmentSummary(
  plan: PlanPayload,
  dept: Department,
): DeptSummary {
  const mine = plan.optimised.tasks.filter((t) => t.department === dept);
  const base = plan.baseline.tasks.filter((t) => t.department === dept);
  const myBlocks = plan.optimised.blocks.filter((b) =>
    b.tasks.some((t) => t.department === dept),
  );
  const statutory = mine.filter((t) => t.criticality === "A");

  return {
    department: dept,
    total: mine.length,
    scheduled: mine.filter((t) => t.scheduled).length,
    scheduledBaseline: base.filter((t) => t.scheduled).length,
    deferred: mine.filter((t) => !t.scheduled).length,
    blocks: myBlocks.length,
    sharedBlocks: myBlocks.filter((b) => b.departments.length > 1).length,
    statutoryTotal: statutory.length,
    statutoryDone: statutory.filter((t) => t.scheduled).length,
    statutoryBaseline: base.filter(
      (t) => t.criticality === "A" && t.scheduled,
    ).length,
    deferredIds: mine.filter((t) => !t.scheduled).map((t) => t.id),
  };
}
