import { ART_WIDTH, CORNER_HEIGHT, CORNER_WIDTH, type CardPosition } from "./table-layout.ts";

interface Corner { x: number; y: number; width: number; height: number }

function cornerAt(position: CardPosition): Corner {
  const scale = position.width / ART_WIDTH;
  return { x: position.x, y: position.y, width: (CORNER_WIDTH + 1) * scale, height: (CORNER_HEIGHT + 1) * scale };
}

export function keepCornersVisible(positions: CardPosition[], width: number, height: number): CardPosition[] | null {
  const occupied: Corner[] = [];
  const result: CardPosition[] = [];
  for (const position of positions) {
    const corner = cornerAt(position);
    const nearby = occupied.filter(other => corner.x < other.x + other.width && other.x < corner.x + corner.width);
    if (nearby.some(other => corner.y < other.y + other.height && other.y < corner.y + corner.height)) {
      const xPositions = [corner.x, ...occupied.flatMap(other => [other.x - corner.width, other.x + other.width])];
      let closest: Corner | undefined;
      let shortest = Number.POSITIVE_INFINITY;
      for (const x of xPositions) {
        if (x < 0 || x + corner.width > width) continue;
        const horizontal = occupied.filter(other => x < other.x + other.width && other.x < x + corner.width);
        const yPositions = [corner.y, ...horizontal.flatMap(other => [other.y - corner.height, other.y + other.height])];
        for (const y of yPositions) {
          if (y < 0 || y + corner.height > height) continue;
          const distance = Math.abs(y - corner.y) + 2 * Math.abs(x - corner.x);
          if (distance >= shortest) continue;
          if (horizontal.some(other => y < other.y + other.height - .01 && other.y < y + corner.height - .01)) continue;
          closest = { ...corner, x, y };
          shortest = distance;
        }
        if (shortest === 0) break;
      }
      if (!closest) return null;
      Object.assign(corner, closest);
    }
    occupied.push(corner);
    result.push({ ...position, x: corner.x, y: corner.y });
  }
  return result;
}
