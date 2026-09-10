/**
 * Indian Railways zones and divisions.
 *
 * Transcribed from the Ministry of Railways list "List of Zones & Divisions"
 * (17 zones, 68 divisions, with year of creation). This is the FIRST real
 * reference data in this application - everything operational is generated and
 * declared as such, but the organisational structure below is an official
 * published fact, not a number our code computed.
 *
 * Note that South Coast Railway does not appear: it was announced in 2019 but
 * is absent from the Ministry list, which still places Waltair under East
 * Coast Railway. We follow the official list.
 *
 * SHORT CODES are the divisional headquarters station codes in common use.
 * They are identifiers for this demonstration's sign-in scheme, not part of
 * the Ministry list. Every ID is zone-qualified, which is also how the railway
 * disambiguates the genuine duplicates below - there really are two Nagpur
 * divisions (CR and SECR) and two Lucknow divisions (NR and NER).
 */

export interface Division {
  /** Division name exactly as the Ministry list gives it. */
  name: string;
  /** Headquarters station code, used to build sign-in IDs. */
  code: string;
  /** Owning zone's code. */
  zone: string;
}

export interface Zone {
  code: string;
  name: string;
  hq: string;
  /** Year of creation, from the Ministry list. */
  year: number;
  divisions: Division[];
}

/** The division this instance has actually solved. */
export const REFERENCE_ZONE = "ECoR";
export const REFERENCE_DIVISION = "WAT";

function z(
  code: string,
  name: string,
  hq: string,
  year: number,
  divisions: [string, string][],
): Zone {
  return {
    code,
    name,
    hq,
    year,
    divisions: divisions.map(([name, dcode]) => ({ name, code: dcode, zone: code })),
  };
}

export const ZONES: readonly Zone[] = [
  z("CR", "Central Railway", "Mumbai", 1951, [
    ["Mumbai", "CSMT"], ["Bhusaval", "BSL"], ["Nagpur", "NGP"],
    ["Solapur", "SUR"], ["Pune", "PUNE"],
  ]),
  z("ER", "Eastern Railway", "Kolkata", 1952, [
    ["Asansol", "ASN"], ["Howrah", "HWH"], ["Malda", "MLDT"], ["Sealdah", "SDAH"],
  ]),
  z("ECR", "East Central Railway", "Hajipur", 2002, [
    ["Sonpur", "SEE"], ["Samastipur", "SPJ"], ["Danapur", "DNR"],
    ["Dhanbad", "DHN"], ["Pt. Deen Dayal Upadhyaya", "DDU"],
  ]),
  z("ECoR", "East Coast Railway", "Bhubaneswar", 2003, [
    ["Khurda Road", "KUR"], ["Sambalpur", "SBP"], ["Waltair", "WAT"],
  ]),
  z("NR", "Northern Railway", "New Delhi", 1952, [
    ["Ambala", "UMB"], ["Delhi", "DLI"], ["Lucknow", "LKO"],
    ["Moradabad", "MB"], ["Firozpur", "FZR"],
  ]),
  z("NCR", "North Central Railway", "Prayagraj", 2003, [
    ["Prayagraj", "PRYJ"], ["Agra", "AGC"], ["Jhansi", "JHS"],
  ]),
  z("NER", "North Eastern Railway", "Gorakhpur", 1952, [
    ["Lucknow", "LJN"], ["Izzatnagar", "IZN"], ["Varanasi", "BSB"],
  ]),
  z("NFR", "Northeast Frontier Railway", "Guwahati", 1958, [
    ["Alipurduar", "APDJ"], ["Katihar", "KIR"], ["Lumding", "LMG"],
    ["Rangiya", "RNY"], ["Tinsukia", "TSK"],
  ]),
  z("NWR", "North Western Railway", "Jaipur", 2002, [
    ["Ajmer", "AII"], ["Bikaner", "BKN"], ["Jaipur", "JP"], ["Jodhpur", "JU"],
  ]),
  z("SR", "Southern Railway", "Chennai", 1951, [
    ["Chennai", "MAS"], ["Madurai", "MDU"], ["Palakkad", "PGT"],
    ["Tiruchchirappalli", "TPJ"], ["Thiruvananthapuram", "TVC"], ["Salem", "SA"],
  ]),
  z("SCR", "South Central Railway", "Secunderabad", 1966, [
    ["Guntakal", "GTL"], ["Guntur", "GNT"], ["Hyderabad", "HYB"],
    ["Nanded", "NED"], ["Secunderabad", "SC"], ["Vijayawada", "BZA"],
  ]),
  z("SER", "South Eastern Railway", "Kolkata", 1955, [
    ["Adra", "ADRA"], ["Chakradharpur", "CKP"], ["Kharagpur", "KGP"],
    ["Ranchi", "RNC"],
  ]),
  z("SECR", "South East Central Railway", "Bilaspur", 2003, [
    ["Raipur", "R"], ["Nagpur", "NGP"], ["Bilaspur", "BSP"],
  ]),
  z("SWR", "South Western Railway", "Hubballi", 2003, [
    ["Bengaluru", "SBC"], ["Hubballi", "UBL"], ["Mysuru", "MYS"],
  ]),
  z("WR", "Western Railway", "Mumbai", 1951, [
    ["Mumbai Central", "BCT"], ["Vadodara", "BRC"], ["Ratlam", "RTM"],
    ["Ahmedabad", "ADI"], ["Rajkot", "RJT"], ["Bhavnagar", "BVP"],
  ]),
  z("WCR", "West Central Railway", "Jabalpur", 2003, [
    ["Bhopal", "BPL"], ["Jabalpur", "JBP"], ["Kota", "KOTA"],
  ]),
  //  Metro Railway Kolkata is a zone with no divisions - the Ministry list
  //  prints a dash. It therefore has a GM and no divisional posts.
  z("Metro", "Metro Railway, Kolkata", "Kolkata", 2010, []),
] as const;

export const ALL_DIVISIONS: readonly Division[] = ZONES.flatMap((zn) => zn.divisions);

export const TOTAL_ZONES = ZONES.length;
export const TOTAL_DIVISIONS = ALL_DIVISIONS.length;

export function zoneByCode(code: string): Zone | null {
  return ZONES.find((zn) => zn.code === code) ?? null;
}
