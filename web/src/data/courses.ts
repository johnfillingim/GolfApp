import { makeCourse, type CourseInfo, type HoleInfo } from '../scoring';

/**
 * Course catalog, ported from `CourseCatalog.swift`.
 *
 * The Swift version also laid out synthetic GPS geometry for each hole so the
 * MapKit view had something to draw. The web app has no map, so the coordinates
 * are dropped and only the scoring card survives — par, stroke index, yardage.
 * The shapes here are still the ingestion contract for a future course API.
 *
 * Rounds freeze their course card at creation, so editing this catalog never
 * rewrites history.
 */

export interface CatalogHole {
  number: number;
  par: number;
  strokeIndex: number;
  yards: number;
}

export interface CatalogCourse {
  id: string;
  name: string;
  location: string;
  holes: CatalogHole[];
}

function make(
  id: string,
  name: string,
  location: string,
  pars: number[],
  strokeIndexes: number[],
  yards: number[],
): CatalogCourse {
  const holes: CatalogHole[] = pars.map((par, index) => ({
    number: index + 1,
    par,
    strokeIndex: strokeIndexes[index]!,
    yards: yards[index]!,
  }));
  return { id, name, location, holes };
}

export const COURSES: CatalogCourse[] = [
  make(
    'demo.pinemeadow',
    'Pine Meadow Links',
    'Demo course · 18 holes',
    [4, 5, 3, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 5, 3, 4, 4],
    [5, 1, 17, 9, 13, 7, 15, 3, 11, 6, 16, 2, 10, 14, 4, 18, 8, 12],
    [385, 540, 165, 410, 395, 430, 180, 555, 370, 400, 155, 570, 415, 380, 525, 145, 445, 405],
  ),
  make(
    'demo.oakridge',
    'Oak Ridge Municipal',
    'Demo course · 18 holes',
    [4, 4, 5, 3, 4, 5, 4, 3, 4, 5, 4, 3, 4, 4, 4, 5, 3, 4],
    [7, 3, 11, 15, 1, 13, 5, 17, 9, 8, 2, 18, 12, 4, 10, 14, 16, 6],
    [370, 425, 510, 175, 460, 495, 390, 150, 405, 520, 440, 160, 385, 450, 395, 505, 170, 415],
  ),
  make(
    'demo.creekside9',
    'Creekside Nine',
    'Demo course · 9 holes',
    [4, 3, 5, 4, 4, 3, 4, 5, 4],
    [3, 7, 1, 5, 9, 8, 4, 2, 6],
    [390, 170, 535, 405, 380, 155, 420, 515, 400],
  ),
];

export function courseByID(id: string): CatalogCourse | undefined {
  return COURSES.find((c) => c.id === id);
}

export function courseInfoFrom(course: CatalogCourse): CourseInfo {
  const holes: HoleInfo[] = course.holes.map((h) => ({
    number: h.number,
    par: h.par,
    strokeIndex: h.strokeIndex,
    yardage: h.yards,
  }));
  return makeCourse(course.name, holes);
}

export function totalPar(course: CatalogCourse): number {
  return course.holes.reduce((sum, h) => sum + h.par, 0);
}

export function totalYards(course: CatalogCourse): number {
  return course.holes.reduce((sum, h) => sum + h.yards, 0);
}

/**
 * A custom card the user types in themselves. Stroke indexes default to hole
 * order, which is wrong for a real course but harmless for gross bets and
 * easily fixed hole by hole.
 */
export function blankCourse(name: string, holeCount: number): CatalogCourse {
  const holes: CatalogHole[] = [];
  for (let number = 1; number <= holeCount; number++) {
    holes.push({ number, par: 4, strokeIndex: number, yards: 400 });
  }
  return {
    id: `custom.${crypto.randomUUID()}`,
    name,
    location: `Custom · ${holeCount} holes`,
    holes,
  };
}
