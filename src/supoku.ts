export type SupokuPokemon = {
  id: number;
  name: string;
  types: string[];
  generation: number;
  evolutionClass: "baby" | "stage1" | "stage2" | "stage3" | "mega";
};

const evolutionClasses: SupokuPokemon["evolutionClass"][] = [
  "baby",
  "stage1",
  "stage2",
  "stage3",
  "mega",
];
const pokemonTypes = [
  "normal", "fire", "water", "electric", "grass", "ice", "fighting",
  "poison", "ground", "flying", "psychic", "bug", "rock", "ghost",
  "dragon", "dark", "steel", "fairy",
];
const regionsByGeneration = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova"];
const cellCount = 16;
const normalBoxUsefulCount = 36;
const normalBoxDecoyCount = 4;

export type SupokuDifficulty = "normal" | "hard";

type DailyPuzzle = {
  date: string;
  generations: number[];
  types: [string, string];
  evolutionClasses: SupokuPokemon["evolutionClass"][];
  answers: SupokuPokemon[];
  givens: Set<number>;
};

type SavedGame = {
  rulesVersion: number;
  date: string;
  solved: number[];
  placements: [number, number][];
  mistakes: number;
  startedAt?: number | null;
  elapsedMs?: number | null;
  revealed?: boolean;
  revealedCorrectCells?: number[];
  difficulty?: SupokuDifficulty;
};

let puzzle: DailyPuzzle | undefined;
let candidatesByProfile = new Map<string, SupokuPokemon[]>();
let pokemonByName = new Map<string, SupokuPokemon>();
let pokemonById = new Map<number, SupokuPokemon>();
let allDailyPokemon: SupokuPokemon[] = [];
let placedPokemonIds = new Map<number, number>();
let selectedCell = 1;
let solvedCells = new Set<number>();
let mistakes = 0;
let startedAt: number | null = null;
let elapsedMs: number | null = null;
let revealed = false;
let revealedCorrectCells = new Set<number>();
let timerInterval: number | undefined;
let nextPuzzleCountdownInterval: number | undefined;
let selectedSupokuSuggestionIndex = -1;
let hintsEnabled = false;
let difficulty: SupokuDifficulty = "hard";
let normalBoxPokemonIds: number[] = [];
let selectedBoxPokemonId: number | undefined;
let pointerDraggedPokemonId: number | undefined;
let pointerDraggedSourceCell: number | undefined;
let activeBoxPointerId: number | undefined;
let pointerDragGhost: HTMLElement | undefined;

function dailyDate(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

function nextDailyPuzzleAt(): Date {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  ));
}

function renderNextPuzzleCountdown(): void {
  const countdown = document.getElementById("nextPuzzleCountdown");
  if (!countdown) return;

  const remainingSeconds = Math.max(
    0,
    Math.floor((nextDailyPuzzleAt().getTime() - Date.now()) / 1000),
  );
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;
  countdown.textContent =
    `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function seededRandom(seedText: string): () => number {
  let seed = 2166136261;
  for (const character of seedText) {
    seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  }

  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled;
}

function shuffledSudoku(random: () => number): number[][] {
  const board = Array.from({ length: 4 }, () => Array<number>(4).fill(-1));

  function fill(position: number): boolean {
    if (position === cellCount) return true;
    const row = Math.floor(position / 4);
    const column = position % 4;
    const candidates = shuffle([0, 1, 2, 3], random).filter((value) => {
      const rowValues = board[row];
      if (rowValues.includes(value)) return false;
      if (board.some((line) => line[column] === value)) return false;
      const boxRow = Math.floor(row / 2) * 2;
      const boxColumn = Math.floor(column / 2) * 2;
      for (let r = boxRow; r < boxRow + 2; r++) {
        for (let c = boxColumn; c < boxColumn + 2; c++) {
          if (board[r][c] === value) return false;
        }
      }
      return true;
    });

    for (const value of candidates) {
      board[row][column] = value;
      if (fill(position + 1)) return true;
    }
    board[row][column] = -1;
    return false;
  }

  fill(0);
  return board;
}

function generationSudoku(): number[][] {
  return Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 4 }, (_, column) => (row * 2 + Math.floor(row / 2) + column) % 4)
  );
}

function canAssignDailyTypes(
  entries: SupokuPokemon[],
  types: [string, string],
  groupIsComplete = false,
): boolean {
  const matchingEntries = entries.filter((entry) =>
    types.some((type) => entry.types.includes(type))
  );
  if (matchingEntries.length > 2) return false;
  if (groupIsComplete && matchingEntries.length !== 2) return false;
  if (matchingEntries.length < 2) return true;

  return (
    matchingEntries.some((entry, index) =>
      entry.types.includes(types[0]) &&
      matchingEntries.some((other, otherIndex) =>
        index !== otherIndex && other.types.includes(types[1])
      )
    ) ||
    matchingEntries.some((entry, index) =>
      entry.types.includes(types[1]) &&
      matchingEntries.some((other, otherIndex) =>
        index !== otherIndex && other.types.includes(types[0])
      )
    )
  );
}

function matchesDailyTypeCategory(
  candidate: SupokuPokemon,
  answer: SupokuPokemon,
  types: [string, string],
): boolean {
  const answerTypes = types.filter((type) => answer.types.includes(type));
  const candidateTypes = types.filter((type) => candidate.types.includes(type));
  return answerTypes.length === 0
    ? candidateTypes.length === 0
    : candidateTypes.some((type) => answerTypes.includes(type));
}

function findAnswerAssignment(
  generationGrid: number[][],
  generations: number[],
  evolutionGrid: number[][],
  classes: SupokuPokemon["evolutionClass"][],
  typeGrid: number[][],
  types: [string, string],
): SupokuPokemon[] | undefined {
  const candidates: SupokuPokemon[][] = [];
  for (let index = 0; index < cellCount; index++) {
    const row = Math.floor(index / 4);
    const column = index % 4;
    const desiredGeneration = generations[generationGrid[row][column]];
    const desiredClass = classes[evolutionGrid[row][column]];
    const typeCategory = typeGrid[row][column];
    const matching = (candidatesByProfile.get(
      `${desiredGeneration}|${desiredClass}`
    ) ?? []).filter((candidate) => {
      const hasFirstType = candidate.types.includes(types[0]);
      const hasSecondType = candidate.types.includes(types[1]);
      return typeCategory === 0
        ? hasFirstType
        : typeCategory === 1
          ? hasSecondType
          : !hasFirstType && !hasSecondType;
    });
    if (matching.length === 0) return undefined;
    candidates.push(matching);
  }

  const answers: (SupokuPokemon | undefined)[] = Array(cellCount);
  const used = new Set<number>();

  function assign(remaining: Set<number>): boolean {
    if (remaining.size === 0) return true;
    let nextCell = -1;
    let available: SupokuPokemon[] = [];

    for (const index of remaining) {
      const options = candidates[index].filter((candidate) => !used.has(candidate.id));
      if (options.length === 0) return false;
      if (nextCell === -1 || options.length < available.length) {
        nextCell = index;
        available = options;
      }
    }

    const nextRemaining = new Set(remaining);
    nextRemaining.delete(nextCell);
    for (const candidate of available) {
      used.add(candidate.id);
      answers[nextCell] = candidate;
      if (assign(nextRemaining)) return true;
      used.delete(candidate.id);
    }
    answers[nextCell] = undefined;
    return false;
  }

  if (!assign(new Set(Array.from({ length: cellCount }, (_, index) => index)))) {
    return undefined;
  }
  return answers.map((answer) => {
    if (!answer) throw new Error("The daily board generator left an empty cell.");
    return answer;
  });
}

function assertPuzzleRules(answers: SupokuPokemon[], types: [string, string]): void {
  const groups: number[][] = [];
  for (let index = 0; index < 4; index++) {
    groups.push(
      Array.from({ length: 4 }, (_, column) => index * 4 + column),
      Array.from({ length: 4 }, (_, row) => row * 4 + index),
    );
  }
  for (let row = 0; row < 4; row += 2) {
    for (let column = 0; column < 4; column += 2) {
      groups.push([
        row * 4 + column,
        row * 4 + column + 1,
        (row + 1) * 4 + column,
        (row + 1) * 4 + column + 1,
      ]);
    }
  }

  if (new Set(answers.map((answer) => answer.id)).size !== cellCount) {
    throw new Error("The generated board contains duplicate Pokémon answers.");
  }

  for (const group of groups) {
    const entries = group.map((index) => answers[index]);
    if (
      new Set(entries.map((answer) => regionForGeneration(answer.generation))).size !== 4 ||
      new Set(entries.map((answer) => answer.evolutionClass)).size !== 4
    ) {
      throw new Error("The generated board does not satisfy the generation/evolution Sudoku rules.");
    }
    if (!canAssignDailyTypes(entries, types, true)) {
      throw new Error("The generated board does not satisfy the daily type rules.");
    }
  }
}

function createPuzzle(date: string): DailyPuzzle {
  const random = seededRandom(date);
  const generationGrid = generationSudoku();
  const generationSets = shuffle(
    [1, 2, 3, 4, 5].map((omitted) =>
      [1, 2, 3, 4, 5].filter((generation) => generation !== omitted)
    ),
    random,
  );
  const typePairs: [string, string][] = [];
  for (let first = 0; first < pokemonTypes.length; first++) {
    for (let second = first + 1; second < pokemonTypes.length; second++) {
      typePairs.push([pokemonTypes[first], pokemonTypes[second]]);
    }
  }

  for (const generations of generationSets) {
    const omittedClassOrder = shuffle([...evolutionClasses], random);
    for (const omittedClass of omittedClassOrder) {
      const dailyEvolutionClasses = shuffle(
        evolutionClasses.filter((evolutionClass) => evolutionClass !== omittedClass),
        random,
      );
      for (const types of shuffle(typePairs, random)) {
        for (let attempt = 0; attempt < 24; attempt++) {
          const evolutionGrid = shuffledSudoku(random);
          const classes = shuffle([...dailyEvolutionClasses], random);
          const typeGrid = shuffledSudoku(random);
          const answers = findAnswerAssignment(
            generationGrid,
            generations,
            evolutionGrid,
            classes,
            typeGrid,
            types,
          );
          if (answers) {
            assertPuzzleRules(answers, types);
            return {
              date,
              generations,
              types,
              evolutionClasses: dailyEvolutionClasses,
              answers,
              givens: new Set([0, 3, 12, 15]),
            };
          }
        }
      }
    }
  }

  throw new Error("Could not build today's SuPoku board from the available Pokémon data.");
}

function readSavedGame(date: string): void {
  const saved = localStorage.getItem("supoku-progress");
  if (!saved) return;

  const state = JSON.parse(saved) as SavedGame;
  if (
    state.rulesVersion !== 5 ||
    state.date !== date ||
    !Array.isArray(state.solved) ||
    !state.solved.every((index) => Number.isInteger(index) && index >= 0 && index < cellCount) ||
    !Number.isInteger(state.mistakes) ||
    state.mistakes < 0 ||
    !(state.startedAt === undefined || state.startedAt === null || (Number.isFinite(state.startedAt) && state.startedAt > 0)) ||
    !(state.elapsedMs === undefined || state.elapsedMs === null || (Number.isFinite(state.elapsedMs) && state.elapsedMs >= 0)) ||
    !(state.revealed === undefined || typeof state.revealed === "boolean") ||
    !(state.revealedCorrectCells === undefined ||
      (Array.isArray(state.revealedCorrectCells) &&
        state.revealedCorrectCells.every((index) =>
          Number.isInteger(index) && index >= 0 && index < cellCount
        ))) ||
    !(state.difficulty === undefined ||
      state.difficulty === "normal" || state.difficulty === "hard")
  ) return;
  solvedCells = new Set(state.solved.filter((index) => !puzzle!.givens.has(index)));
  if (Array.isArray(state.placements)) {
    for (const [index, id] of state.placements) {
      const placedPokemon = pokemonById.get(id);
      if (
        Number.isInteger(index) &&
        index >= 0 &&
        index < cellCount &&
        placedPokemon &&
        solvedCells.has(index) &&
        !puzzle!.givens.has(index)
      ) {
        placedPokemonIds.set(index, id);
      }
    }
  }
  mistakes = state.mistakes;
  startedAt = state.startedAt ?? null;
  elapsedMs = state.elapsedMs ?? null;
  revealed = state.revealed ?? false;
  revealedCorrectCells = new Set(state.revealedCorrectCells ?? []);
  difficulty = state.difficulty ?? "hard";
}

function saveGame(): void {
  if (!puzzle) return;
  localStorage.setItem("supoku-progress", JSON.stringify({
    rulesVersion: 5,
    date: puzzle.date,
    solved: [...solvedCells],
    placements: [...placedPokemonIds.entries()],
    mistakes,
    startedAt,
    elapsedMs,
    revealed,
    revealedCorrectCells: [...revealedCorrectCells],
    difficulty,
  } satisfies SavedGame));
}

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function currentElapsedMs(): number {
  if (elapsedMs !== null) return elapsedMs;
  return startedAt === null ? 0 : Date.now() - startedAt;
}

function renderTimer(): void {
  document.getElementById("supokuTimer")!.textContent = formatTime(currentElapsedMs());
}

function startTimer(): void {
  if (elapsedMs !== null || (solvedCells.size === 12 && getRuleConflicts().size === 0)) return;
  if (startedAt === null) {
    startedAt = Date.now();
    saveGame();
  }
  if (timerInterval !== undefined) window.clearInterval(timerInterval);
  renderTimer();
  timerInterval = window.setInterval(renderTimer, 250);
}

function finishPuzzle(wasRevealed = false): void {
  if (!puzzle) return;
  if (elapsedMs === null) {
    elapsedMs = currentElapsedMs();
    startedAt = null;
    revealed = wasRevealed;
    if (timerInterval !== undefined) {
      window.clearInterval(timerInterval);
      timerInterval = undefined;
    }
    saveGame();
  }
  renderTimer();
  document.getElementById("supokuCompletionTime")!.textContent = formatTime(elapsedMs);
  document.getElementById("supokuCompletionTitle")!.textContent =
    revealed ? "Puzzle revealed" : "Daily puzzle complete!";
  document.getElementById("supokuCompletion")!.hidden = false;
  document.getElementById("supokuActionRow")!.hidden = true;
  document.getElementById("supokuSearchRow")!.hidden = true;
  document.getElementById("supokuStatus")!.textContent = revealed
    ? "Answers revealed. Come back tomorrow for a new puzzle."
    : "Daily board complete! Come back tomorrow for a new puzzle.";
}

function formatName(name: string): string {
  return name.split("-").map((part) =>
    part.charAt(0).toUpperCase() + part.slice(1)
  ).join(" ");
}

function regionForGeneration(generation: number): string {
  return regionsByGeneration[generation - 1] ?? `Generation ${generation}`;
}

function formatEvolutionClass(evolutionClass: SupokuPokemon["evolutionClass"]): string {
  const labels: Record<SupokuPokemon["evolutionClass"], string> = {
    baby: "Baby",
    stage1: "Basic",
    stage2: "Stage 1",
    stage3: "Stage 2",
    mega: "Mega",
  };
  return labels[evolutionClass];
}

function getRuleGroups(): number[][] {
  const groups: number[][] = [];
  for (let index = 0; index < 4; index++) {
    groups.push(
      Array.from({ length: 4 }, (_, column) => index * 4 + column),
      Array.from({ length: 4 }, (_, row) => row * 4 + index),
    );
  }
  for (let row = 0; row < 4; row += 2) {
    for (let column = 0; column < 4; column += 2) {
      groups.push([
        row * 4 + column,
        row * 4 + column + 1,
        (row + 1) * 4 + column,
        (row + 1) * 4 + column + 1,
      ]);
    }
  }
  return groups;
}

function getPokemonAtCell(index: number): SupokuPokemon | undefined {
  if (!puzzle) return undefined;
  const pokemonId = placedPokemonIds.get(index);
  if (pokemonId !== undefined) return pokemonById.get(pokemonId);
  return puzzle.givens.has(index) ? puzzle.answers[index] : undefined;
}

function isCandidateAllowedInGroup(
  candidate: SupokuPokemon,
  group: number[],
  targetIndex: number,
): boolean {
  if (!puzzle) return false;
  const entries = group
    .filter((index) => index !== targetIndex)
    .flatMap((index) => {
      const entry = getPokemonAtCell(index);
      return entry ? [entry] : [];
    });
  if (entries.some((entry) =>
    entry.generation === candidate.generation ||
    entry.evolutionClass === candidate.evolutionClass
  )) return false;

  const typeEntries = [...entries, candidate].filter((entry) =>
    puzzle!.types.some((type) => entry.types.includes(type))
  );
  return canAssignDailyTypes(
    typeEntries,
    puzzle.types,
    entries.length + 1 === group.length
  );
}

function getCellCandidates(index: number): SupokuPokemon[] {
  if (!puzzle) return [];
  const usedElsewhere = new Set<number>();
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
    if (cellIndex === index) continue;
    const entry = getPokemonAtCell(cellIndex);
    if (entry) usedElsewhere.add(entry.id);
  }
  const affectedGroups = getRuleGroups().filter((group) => group.includes(index));

  return allDailyPokemon.filter((candidate) =>
    !usedElsewhere.has(candidate.id) &&
    puzzle!.generations.includes(candidate.generation) &&
    puzzle!.evolutionClasses.includes(candidate.evolutionClass) &&
    affectedGroups.every((group) => isCandidateAllowedInGroup(candidate, group, index))
  );
}

function formatCellHint(index: number): string {
  const candidates = getCellCandidates(index);
  if (candidates.length === 0) return "No possible categories";

  const regions = [...new Set(candidates.map((candidate) =>
    regionForGeneration(candidate.generation)
  ))].sort((first, second) => regionsByGeneration.indexOf(first) - regionsByGeneration.indexOf(second));
  const classes = evolutionClasses
    .filter((evolutionClass) => candidates.some((candidate) =>
      candidate.evolutionClass === evolutionClass
    ))
    .map(formatEvolutionClass);

  return [regions.join("/"), classes.join("/")].join(" · ");
}

function matchesCellAnswerCategory(candidate: SupokuPokemon, index: number): boolean {
  if (!puzzle) return false;
  const answer = puzzle.answers[index];
  return candidate.generation === answer.generation &&
    candidate.evolutionClass === answer.evolutionClass &&
    matchesDailyTypeCategory(candidate, answer, puzzle.types);
}

function createNormalBoxPokemon(): number[] {
  if (!puzzle) return [];
  const openCells = puzzle.answers
    .map((_, index) => index)
    .filter((index) => !puzzle!.givens.has(index));
  const usedPokemon = new Set(
    [...puzzle.givens].map((index) => puzzle!.answers[index].id)
  );
  const usefulById = new Map<number, SupokuPokemon>();

  for (const index of openCells) {
    const answer = puzzle.answers[index];
    usefulById.set(answer.id, answer);
  }
  const otherUseful = allDailyPokemon.filter((candidate) =>
    !usedPokemon.has(candidate.id) &&
    openCells.some((index) => matchesCellAnswerCategory(candidate, index))
  );
  const random = seededRandom(`${puzzle.date}-normal-box`);
  const shuffledUseful = shuffle(otherUseful, random);
  for (const candidate of shuffledUseful) {
    if (usefulById.size >= normalBoxUsefulCount) break;
    usefulById.set(candidate.id, candidate);
  }
  if (usefulById.size < normalBoxUsefulCount) {
    throw new Error(
      `The Normal-mode box needs ${normalBoxUsefulCount} useful Pokémon, but only ${usefulById.size} are available.`
    );
  }

  const useful = shuffle([...usefulById.values()], random)
    .slice(0, normalBoxUsefulCount);
  const usefulIds = new Set(useful.map((candidate) => candidate.id));
  const decoys = shuffle(
    allDailyPokemon.filter((candidate) =>
      !usedPokemon.has(candidate.id) &&
      !usefulIds.has(candidate.id) &&
      (!puzzle!.generations.includes(candidate.generation) ||
        !puzzle!.evolutionClasses.includes(candidate.evolutionClass))
    ),
    random,
  ).slice(0, normalBoxDecoyCount);
  if (decoys.length < normalBoxDecoyCount) {
    throw new Error(
      `The Normal-mode box needs ${normalBoxDecoyCount} decoys, but only ${decoys.length} are available.`
    );
  }
  return shuffle([...useful, ...decoys], random).map((candidate) => candidate.id);
}

function renderNormalBox(): void {
  const panel = document.getElementById("supokuBoxPanel")!;
  const box = document.getElementById("supokuPokemonBox")!;
  panel.hidden = difficulty !== "normal";
  box.innerHTML = "";
  if (difficulty !== "normal") return;

  for (const pokemonId of normalBoxPokemonIds) {
    const pokemon = pokemonById.get(pokemonId);
    if (!pokemon) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "supoku-box-pokemon";
    button.draggable = true;
    button.dataset.pokemonId = String(pokemon.id);
    button.setAttribute("aria-label", `Choose ${formatName(pokemon.name)} from storage box`);
    const used = [...placedPokemonIds.values()].includes(pokemon.id);
    button.disabled = used;
    button.classList.toggle("used", used);
    button.classList.toggle("chosen", selectedBoxPokemonId === pokemon.id);
    button.title = `${formatName(pokemon.name)}${used ? " — placed" : ""}`;
    button.innerHTML = `
      <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.id}.png" alt="" draggable="false" />
      <span>${formatName(pokemon.name)}</span>
    `;
    button.addEventListener("click", () => {
      if (button.disabled) return;
      selectedBoxPokemonId = selectedBoxPokemonId === pokemon.id ? undefined : pokemon.id;
      box.querySelectorAll<HTMLButtonElement>(".supoku-box-pokemon").forEach((item) => {
        item.classList.toggle("chosen", Number(item.dataset.pokemonId) === selectedBoxPokemonId);
      });
      document.getElementById("supokuFeedback")!.textContent = selectedBoxPokemonId === undefined
        ? "Pokémon selection cleared."
        : `${formatName(pokemon.name)} selected. Tap an empty cell or drag it there.`;
    });
    button.addEventListener("dragstart", (event) => {
      if (!event.dataTransfer || button.disabled) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.setData("text/plain", `box:${pokemon.id}`);
      event.dataTransfer.effectAllowed = "move";
      selectedBoxPokemonId = pokemon.id;
    });
    button.addEventListener("dragend", clearBoxDragState);
    button.addEventListener("pointerdown", (event) => {
      if (button.disabled) return;
      startTouchBoxDrag(event, pokemon);
    });
    box.appendChild(button);
  }
}

function clearBoxDragState(): void {
  pointerDraggedPokemonId = undefined;
  pointerDraggedSourceCell = undefined;
  activeBoxPointerId = undefined;
  pointerDragGhost?.remove();
  pointerDragGhost = undefined;
  document.querySelectorAll(".supoku-cell.drop-target").forEach((element) =>
    element.classList.remove("drop-target")
  );
}

function findDropCell(target: EventTarget | null): HTMLButtonElement | undefined {
  if (!(target instanceof Element)) return undefined;
  const cell = target.closest<HTMLButtonElement>(".supoku-cell:not(:disabled)");
  return cell ?? undefined;
}

function placeFromBox(pokemonId: number, cell: HTMLButtonElement): void {
  const index = Number(cell.dataset.cellIndex);
  const pokemon = pokemonById.get(pokemonId);
  if (!pokemon || !Number.isInteger(index)) return;
  placePokemonInCell(index, pokemon);
}

function movePlacedPokemon(sourceIndex: number, targetIndex: number): void {
  if (
    !puzzle ||
    sourceIndex === targetIndex ||
    puzzle.givens.has(sourceIndex) ||
    puzzle.givens.has(targetIndex) ||
    !solvedCells.has(sourceIndex) ||
    elapsedMs !== null
  ) return;

  const sourcePokemonId = placedPokemonIds.get(sourceIndex);
  if (sourcePokemonId === undefined) return;
  const targetPokemonId = placedPokemonIds.get(targetIndex);
  if (targetPokemonId === undefined) {
    placedPokemonIds.delete(sourceIndex);
    solvedCells.delete(sourceIndex);
  } else {
    placedPokemonIds.set(sourceIndex, targetPokemonId);
  }
  placedPokemonIds.set(targetIndex, sourcePokemonId);
  solvedCells.add(targetIndex);
  selectedCell = sourceIndex;
  selectedBoxPokemonId = undefined;
  saveGame();
  renderBoard();
}

function startTouchBoxDrag(
  event: PointerEvent,
  pokemon: SupokuPokemon,
  sourceCell?: number,
): void {
  if (event.pointerType !== "touch") return;
  event.preventDefault();
  activeBoxPointerId = event.pointerId;
  pointerDraggedPokemonId = pokemon.id;
  pointerDraggedSourceCell = sourceCell;
  selectedBoxPokemonId = pokemon.id;
  pointerDragGhost = document.createElement("div");
  pointerDragGhost.className = "supoku-box-drag-ghost";
  pointerDragGhost.innerHTML = `<img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.id}.png" alt="" /><span>${formatName(pokemon.name)}</span>`;
  document.body.appendChild(pointerDragGhost);
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  moveBoxPointerGhost(event);
}

function moveBoxPointerGhost(event: PointerEvent): void {
  if (activeBoxPointerId !== event.pointerId || !pointerDragGhost) return;
  pointerDragGhost.style.left = `${event.clientX + 12}px`;
  pointerDragGhost.style.top = `${event.clientY + 12}px`;
  document.querySelectorAll(".supoku-cell.drop-target").forEach((element) =>
    element.classList.remove("drop-target")
  );
  findDropCell(document.elementFromPoint(event.clientX, event.clientY))
    ?.classList.add("drop-target");
}

function onBoxPointerUp(event: PointerEvent): void {
  if (
    activeBoxPointerId !== event.pointerId ||
    (pointerDraggedPokemonId === undefined && pointerDraggedSourceCell === undefined)
  ) return;
  const cell = findDropCell(document.elementFromPoint(event.clientX, event.clientY));
  if (cell && pointerDraggedSourceCell !== undefined) {
    movePlacedPokemon(pointerDraggedSourceCell, Number(cell.dataset.cellIndex));
  } else if (cell && pointerDraggedPokemonId !== undefined) {
    placeFromBox(pointerDraggedPokemonId, cell);
  }
  clearBoxDragState();
}

function renderBoard(): void {
  if (!puzzle) return;
  const board = document.getElementById("supokuBoard")!;
  board.classList.toggle("hints-enabled", hintsEnabled);
  board.innerHTML = "";
  const conflicts = getRuleConflicts();

  puzzle.answers.forEach((answer, index) => {
    const cell = document.createElement("div");
    cell.className = "supoku-cell-wrap";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "supoku-cell";
    const isGiven = puzzle!.givens.has(index);
    const isSolved = solvedCells.has(index);
    if (isGiven) button.classList.add("given");
    if (isSolved) button.classList.add("solved");
    if (conflicts.has(index)) button.classList.add("conflict");
    if (selectedCell === index) button.classList.add("selected");
    button.disabled = isGiven ||
      (isSolved && (difficulty !== "normal" || revealed || elapsedMs !== null));
    if (isSolved) button.setAttribute("aria-disabled", "true");
    button.dataset.cellIndex = String(index);
    const shownPokemon = pokemonById.get(placedPokemonIds.get(index) ?? -1) ?? answer;
    button.setAttribute(
      "aria-label",
      `Cell ${index + 1}${isGiven || isSolved
        ? `, ${formatName(shownPokemon.name)}, ${regionForGeneration(shownPokemon.generation)}, ${shownPokemon.types.map(formatName).join(" and ")}, ${formatEvolutionClass(shownPokemon.evolutionClass)}`
        : ", hidden answer"}`
    );
    if (isGiven || isSolved) {
      button.innerHTML = `
        <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${shownPokemon.id}.png" alt="" />
        <span class="supoku-pokemon-name">${formatName(shownPokemon.name)}</span>
        <small class="supoku-cell-details">
          <span>${regionForGeneration(shownPokemon.generation)} · ${shownPokemon.types.map(formatName).join("/")}</span>
          <span>${formatEvolutionClass(shownPokemon.evolutionClass)}</span>
        </small>
      `;
      if (isSolved && !isGiven && !button.disabled) {
        button.draggable = true;
        button.classList.add("supoku-movable");
        button.setAttribute(
          "aria-label",
          `${button.getAttribute("aria-label")}. Drag to move or swap this Pokémon.`
        );
        button.addEventListener("dragstart", (event) => {
          if (!event.dataTransfer) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.setData("text/plain", `cell:${index}`);
          event.dataTransfer.effectAllowed = "move";
          selectedBoxPokemonId = undefined;
        });
        button.addEventListener("dragend", clearBoxDragState);
        button.addEventListener("pointerdown", (event) => {
          startTouchBoxDrag(event, shownPokemon, index);
        });
      }
    } else {
      button.innerHTML = `
        <span class="supoku-hidden">${String(index + 1).padStart(2, "0")}</span>
        <small>Tap to select</small>
        ${hintsEnabled ? `<small class="supoku-cell-hint">${formatCellHint(index)}</small>` : ""}
      `;
      button.addEventListener("click", () => {
        if (difficulty === "normal" && selectedBoxPokemonId !== undefined) {
          const selectedPokemon = pokemonById.get(selectedBoxPokemonId);
          if (selectedPokemon) {
            placePokemonInCell(index, selectedPokemon);
            return;
          }
        }
        selectedCell = index;
        renderBoard();
      });
    }
    button.addEventListener("dragover", (event) => {
      if (
        difficulty !== "normal" ||
        isGiven ||
        (isSolved && (revealed || elapsedMs !== null))
      ) return;
      event.preventDefault();
      button.classList.add("drop-target");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    button.addEventListener("dragleave", () => button.classList.remove("drop-target"));
    button.addEventListener("drop", (event) => {
      if (
        difficulty !== "normal" ||
        isGiven ||
        (isSolved && (revealed || elapsedMs !== null))
      ) return;
      event.preventDefault();
      const payload = event.dataTransfer?.getData("text/plain") ?? "";
      const boxMatch = /^box:(\d+)$/.exec(payload);
      const cellMatch = /^cell:(\d+)$/.exec(payload);
      if (boxMatch) {
        placeFromBox(Number(boxMatch[1]), button);
      } else if (cellMatch) {
        movePlacedPokemon(Number(cellMatch[1]), index);
      }
      clearBoxDragState();
    });
    cell.appendChild(button);
    if (isSolved && !isGiven && !revealed && elapsedMs === null) {
      const clearButton = document.createElement("button");
      clearButton.type = "button";
      clearButton.className = "supoku-clear";
      clearButton.textContent = "×";
      clearButton.title = "Clear this answer";
      clearButton.setAttribute("aria-label", `Clear answer in cell ${index + 1}`);
      clearButton.addEventListener("click", () => clearCell(index));
      cell.appendChild(clearButton);
    }
    if (revealed && !isGiven) {
      const alternativesButton = document.createElement("button");
      alternativesButton.type = "button";
      alternativesButton.className = "supoku-shuffle";
      alternativesButton.textContent = "🔀";
      alternativesButton.title = "Show another possible answer";
      alternativesButton.setAttribute("aria-label", `Show another possible answer for cell ${index + 1}`);
      alternativesButton.addEventListener("click", () => cycleAlternative(index));
      cell.appendChild(alternativesButton);
    }
    board.appendChild(cell);
  });

  document.getElementById("supokuMistakes")!.textContent = String(conflicts.size);
  document.getElementById("supokuProgress")!.textContent = `${solvedCells.size + puzzle.givens.size}/16`;
  document.getElementById("supokuPossibleAnswers")!.textContent =
    String(possibleAnswers(selectedCell).length);
  document.getElementById("supokuStatus")!.textContent = revealed
    ? "Answers revealed. Come back tomorrow for a new puzzle."
    : solvedCells.size === 12 && conflicts.size > 0
      ? "The board is full. Replace Pokémon in red cells to resolve rule conflicts."
      : conflicts.size > 0
        ? "Red cells and their highlighted partners conflict with the daily rules."
        : solvedCells.size === 12
          ? "Daily board complete! Come back tomorrow for a new puzzle."
          : "Fill each hidden cell with a Pokémon. Your progress is saved on this device.";
  if (!revealed && solvedCells.size === 12 && conflicts.size === 0) {
    finishPuzzle();
  }
  renderNormalBox();
}

function getRuleConflicts(): Set<number> {
  if (!puzzle) return new Set();
  const currentPuzzle = puzzle;
  const conflicts = new Set<number>();

  for (let index = 0; index < cellCount; index++) {
    const pokemonId = placedPokemonIds.get(index);
    if (pokemonId === undefined && !currentPuzzle.givens.has(index)) continue;
    const entry = pokemonId === undefined
      ? currentPuzzle.answers[index]
      : pokemonById.get(pokemonId);
    if (!entry) continue;
    if (
      !currentPuzzle.generations.includes(entry.generation) ||
      !currentPuzzle.evolutionClasses.includes(entry.evolutionClass)
    ) {
      conflicts.add(index);
    }
  }

  const cellsByPokemonId = new Map<number, number[]>();
  for (let index = 0; index < cellCount; index++) {
    const pokemonId = placedPokemonIds.get(index) ??
      (currentPuzzle.givens.has(index) ? currentPuzzle.answers[index].id : undefined);
    if (pokemonId === undefined) continue;
    const cells = cellsByPokemonId.get(pokemonId) ?? [];
    cells.push(index);
    cellsByPokemonId.set(pokemonId, cells);
  }
  for (const cells of cellsByPokemonId.values()) {
    if (cells.length > 1) cells.forEach((index) => conflicts.add(index));
  }

  for (const group of getRuleGroups()) {
    const entries = group.flatMap((index) => {
      const pokemonId = placedPokemonIds.get(index);
      if (pokemonId === undefined && !currentPuzzle.givens.has(index)) return [];
      const entry = pokemonId === undefined
        ? currentPuzzle.answers[index]
        : pokemonById.get(pokemonId);
      return entry ? [{ index, entry }] : [];
    });

    for (const key of ["generation", "evolutionClass"] as const) {
      const membersByCategory = new Map<string | number, number[]>();
      for (const { index, entry } of entries) {
        const members = membersByCategory.get(entry[key]) ?? [];
        members.push(index);
        membersByCategory.set(entry[key], members);
      }
      for (const members of membersByCategory.values()) {
        if (members.length > 1) members.forEach((index) => conflicts.add(index));
      }
    }

    const typeEntries = entries.filter(({ entry }) =>
      currentPuzzle.types.some((type) => entry.types.includes(type))
    );
    if (!canAssignDailyTypes(
      typeEntries.map(({ entry }) => entry),
      currentPuzzle.types,
      entries.length === 4
    )) {
      typeEntries.forEach(({ index }) => conflicts.add(index));
      if (entries.length === 4) entries.forEach(({ index }) => conflicts.add(index));
    }
  }

  return conflicts;
}

function clearCell(index: number): void {
  solvedCells.delete(index);
  placedPokemonIds.delete(index);
  selectedCell = index;
  selectedBoxPokemonId = undefined;
  document.getElementById("supokuFeedback")!.textContent = "";
  saveGame();
  renderBoard();
}

function possibleAnswers(index: number): SupokuPokemon[] {
  if (!puzzle) return [];
  const answer = puzzle.answers[index];
  const requiredType = answer.types.find((type) => puzzle!.types.includes(type));
  const otherType = puzzle.types.find((type) => type !== requiredType);
  const answerHasBothTypes = puzzle.types.every((type) => answer.types.includes(type));
  const usedElsewhere = new Set(
    [...placedPokemonIds.entries()]
      .filter(([cellIndex]) => cellIndex !== index)
      .map(([, pokemonId]) => pokemonId)
  );
  for (const givenIndex of puzzle.givens) {
    if (givenIndex !== index) usedElsewhere.add(puzzle.answers[givenIndex].id);
  }
  return allDailyPokemon
    .filter((candidate) =>
      !usedElsewhere.has(candidate.id) &&
      candidate.generation === answer.generation &&
      candidate.evolutionClass === answer.evolutionClass &&
      (requiredType
        ? answerHasBothTypes
          ? candidate.types.includes(requiredType) ||
            candidate.types.includes(otherType!)
          : candidate.types.includes(requiredType)
        : !candidate.types.includes(puzzle!.types[0]) &&
          !candidate.types.includes(puzzle!.types[1]))
    )
    .sort((first, second) => first.name.localeCompare(second.name));
}

function cycleAlternative(index: number): void {
  const options = possibleAnswers(index);
  if (options.length < 2) {
    document.getElementById("supokuFeedback")!.textContent =
      "There are no other valid Pokémon answers for this cell.";
    return;
  }
  const currentId = placedPokemonIds.get(index);
  const currentIndex = options.findIndex((candidate) => candidate.id === currentId);
  const next = options[(currentIndex + 1) % options.length];
  placedPokemonIds.set(index, next.id);
  saveGame();
  document.getElementById("supokuFeedback")!.textContent =
    `Another valid answer for cell ${index + 1}: ${formatName(next.name)}.`;
  renderBoard();
}

function hideSupokuSuggestions(): void {
  const suggestions = document.getElementById("supokuSuggestions")!;
  suggestions.innerHTML = "";
  suggestions.hidden = true;
  selectedSupokuSuggestionIndex = -1;
}

function updateSupokuSuggestionHighlight(options: HTMLElement[]): void {
  options.forEach((option, index) => {
    option.classList.toggle("selected", index === selectedSupokuSuggestionIndex);
  });
}

function selectSupokuSuggestion(name: string): void {
  const input = document.getElementById("supokuInput") as HTMLInputElement;
  input.value = name;
  hideSupokuSuggestions();
  input.focus();
}

function renderSupokuSuggestions(): void {
  const input = document.getElementById("supokuInput") as HTMLInputElement;
  const suggestions = document.getElementById("supokuSuggestions")!;
  const query = input.value.toLowerCase().trim().replaceAll(" ", "-");
  suggestions.innerHTML = "";
  selectedSupokuSuggestionIndex = -1;

  if (query.length < 2) {
    suggestions.hidden = true;
    input.setAttribute("aria-expanded", "false");
    return;
  }

  const matches = allDailyPokemon
    .filter((pokemon) => pokemon.name.startsWith(query))
    .slice(0, 8);
  if (matches.length === 0) {
    suggestions.hidden = true;
    input.setAttribute("aria-expanded", "false");
    return;
  }

  matches.forEach((pokemon) => {
    const option = document.createElement("div");
    option.className = "suggestion";
    option.setAttribute("role", "option");
    option.textContent = formatName(pokemon.name);
    option.addEventListener("click", () => selectSupokuSuggestion(pokemon.name));
    suggestions.appendChild(option);
  });
  suggestions.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function placePokemonInCell(index: number, candidate: SupokuPokemon): void {
  if (!puzzle || solvedCells.size === 12 || elapsedMs !== null) return;
  const feedback = document.getElementById("supokuFeedback")!;
  if (puzzle.givens.has(index) || solvedCells.has(index)) {
    feedback.textContent = "Choose an empty cell first.";
    return;
  }
  if (difficulty === "normal") {
    if (!normalBoxPokemonIds.includes(candidate.id)) {
      feedback.textContent = "Choose a Pokémon from the storage box.";
      return;
    }
    if ([...placedPokemonIds.entries()].some(([cellIndex, pokemonId]) =>
      cellIndex !== index && pokemonId === candidate.id
    ) || [...puzzle.givens].some((givenIndex) =>
      givenIndex !== index && puzzle!.answers[givenIndex].id === candidate.id
    )) {
      feedback.textContent = "That Pokémon has already been used.";
      return;
    }
  }
  solvedCells.add(index);
  placedPokemonIds.set(index, candidate.id);
  selectedCell = index;
  selectedBoxPokemonId = undefined;
  feedback.textContent = "";
  const input = document.getElementById("supokuInput") as HTMLInputElement;
  input.value = "";
  hideSupokuSuggestions();
  saveGame();
  const nextCell = puzzle.answers.findIndex((_, candidateIndex) =>
    !puzzle!.givens.has(candidateIndex) && !solvedCells.has(candidateIndex)
  );
  if (nextCell !== -1) selectedCell = nextCell;
  renderBoard();
}

function submitCellGuess(): void {
  if (!puzzle || solvedCells.size === 12 || elapsedMs !== null) return;
  const input = document.getElementById("supokuInput") as HTMLInputElement;
  const guess = input.value.toLowerCase().trim().replaceAll(" ", "-");
  const candidate = pokemonByName.get(guess);
  const feedback = document.getElementById("supokuFeedback")!;

  if (!guess) {
    feedback.textContent = "Choose a Pokémon for the selected cell first.";
    return;
  }
  if (!candidate) {
    feedback.textContent = "Choose a Pokémon from the search suggestions.";
    return;
  }
  placePokemonInCell(selectedCell, candidate);
}

function revealBoard(): void {
  if (!puzzle) return;
  const confirmation = document.getElementById("supokuRevealConfirm") as HTMLDialogElement;
  confirmation.showModal();
}

function confirmRevealBoard(): void {
  if (!puzzle) return;
  revealedCorrectCells = new Set(
    [...solvedCells].filter((index) => {
      const pokemonId = placedPokemonIds.get(index);
      const guess = pokemonId === undefined ? undefined : pokemonById.get(pokemonId);
      const answer = puzzle!.answers[index];
      return guess !== undefined &&
        guess.generation === answer.generation &&
        guess.evolutionClass === answer.evolutionClass &&
        matchesDailyTypeCategory(guess, answer, puzzle!.types);
    })
  );
  for (let index = 0; index < cellCount; index++) {
    if (!puzzle.givens.has(index)) {
      solvedCells.add(index);
      placedPokemonIds.set(index, puzzle.answers[index].id);
    }
  }
  (document.getElementById("supokuRevealConfirm") as HTMLDialogElement).close();
  finishPuzzle(true);
  document.getElementById("supokuFeedback")!.textContent = "Today's answers have been revealed.";
  renderBoard();
}

async function shareBoard(): Promise<void> {
  if (!puzzle) return;
  const progress = puzzle.answers.map((_, index) =>
    revealed
      ? revealedCorrectCells.has(index) ? "🟩" : "⬛"
      : puzzle!.givens.has(index) || solvedCells.has(index) ? "🟩" : "⬛"
  );
  const conflicts = getRuleConflicts();
  const result = revealed ? "Revealed" : solvedCells.size === 12 && conflicts.size === 0 ? "Solved" : "In progress";
  const time = formatTime(currentElapsedMs());
  const text = `Daily SuPoku ${puzzle.date}\n${[0, 1, 2, 3]
    .map((row) => progress.slice(row * 4, row * 4 + 4).join(""))
    .join("\n")}\n${result} ${solvedCells.size + puzzle.givens.size}/16 · ${time} · ${conflicts.size} conflicts`;
  const feedback = document.getElementById("supokuFeedback")!;
  const sharePromise = navigator.share
    ? navigator.share({ title: "Daily SuPoku", text }).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        throw error;
      })
    : undefined;

  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    feedback.textContent = error instanceof Error
      ? `Could not copy result: ${error.message}`
      : "Could not copy result.";
    return;
  }

  if (sharePromise) {
    try {
      await sharePromise;
    } catch (error) {
      feedback.textContent = error instanceof Error
        ? `Result copied, but sharing failed: ${error.message}`
        : "Result copied, but sharing failed.";
      return;
    }
  }
  feedback.textContent = "Result copied to clipboard.";
}

export function initDailySupoku(data: SupokuPokemon[]): void {
  allDailyPokemon = data;
  pokemonByName = new Map(data.map((entry) => [entry.name, entry]));
  pokemonById = new Map(data.map((entry) => [entry.id, entry]));
  candidatesByProfile = new Map();
  for (const entry of data) {
    const key = `${entry.generation}|${entry.evolutionClass}`;
    const matching = candidatesByProfile.get(key) ?? [];
    matching.push(entry);
    candidatesByProfile.set(key, matching);
  }
  const date = dailyDate();
  renderNextPuzzleCountdown();
  if (nextPuzzleCountdownInterval !== undefined) {
    window.clearInterval(nextPuzzleCountdownInterval);
  }
  nextPuzzleCountdownInterval = window.setInterval(renderNextPuzzleCountdown, 1000);
  puzzle = createPuzzle(date);
  normalBoxPokemonIds = createNormalBoxPokemon();
  selectedBoxPokemonId = undefined;
  solvedCells = new Set();
  placedPokemonIds = new Map();
  mistakes = 0;
  startedAt = null;
  elapsedMs = null;
  revealed = false;
  revealedCorrectCells = new Set();
  hintsEnabled = false;
  readSavedGame(date);
  const difficultySelect = document.getElementById("supokuDifficulty") as HTMLSelectElement;
  difficultySelect.value = difficulty;
  document.getElementById("supokuDifficultyDescription")!.textContent =
    difficulty === "normal"
      ? "Choose from 40 Pokémon in the storage box. The box includes useful choices and decoys."
      : "Search for any Pokémon and place it in the selected cell. Wrong choices create conflicts.";
  const firstUnsolved = puzzle.answers.findIndex((_, index) =>
    !puzzle!.givens.has(index) && !solvedCells.has(index)
  );
  if (firstUnsolved !== -1) selectedCell = firstUnsolved;

  document.getElementById("supokuEvolutionClasses")!.textContent =
    [...puzzle.evolutionClasses]
      .sort((first, second) => evolutionClasses.indexOf(first) - evolutionClasses.indexOf(second))
      .map(formatEvolutionClass)
      .join(" · ");
  document.getElementById("supokuGenerations")!.textContent =
    [...puzzle.generations]
      .sort((first, second) => first - second)
      .map(regionForGeneration)
      .join(" · ");
  const typeOne = document.getElementById("supokuTypeOne") as HTMLImageElement;
  typeOne.src = `/Types/${puzzle.types[0]}.png`;
  typeOne.alt = `${formatName(puzzle.types[0])} type`;
  const typeTwo = document.getElementById("supokuTypeTwo") as HTMLImageElement;
  typeTwo.src = `/Types/${puzzle.types[1]}.png`;
  typeTwo.alt = `${formatName(puzzle.types[1])} type`;
  document.getElementById("supokuDate")!.textContent = date;
  document.getElementById("supokuWelcomeDate")!.textContent = date;
  document.getElementById("supokuCompletion")!.hidden = true;
  document.getElementById("supokuActionRow")!.hidden = false;
  document.getElementById("supokuSearchRow")!.hidden = difficulty === "normal";
  renderTimer();
  const hintToggle = document.getElementById("supokuHintToggle") as HTMLButtonElement;
  hintToggle.setAttribute("aria-pressed", "false");
  hintToggle.setAttribute("aria-label", "Show hints");
  hintToggle.title = "Show hints";
  if (revealed || (solvedCells.size === 12 && getRuleConflicts().size === 0)) {
    finishPuzzle(revealed);
  }
  renderBoard();

  document.getElementById("supokuGuessBtn")!.addEventListener("click", submitCellGuess);
  window.addEventListener("pointermove", moveBoxPointerGhost);
  window.addEventListener("pointerup", onBoxPointerUp);
  window.addEventListener("pointercancel", clearBoxDragState);
  hintToggle.addEventListener("click", () => {
    hintsEnabled = !hintsEnabled;
    hintToggle.setAttribute("aria-pressed", String(hintsEnabled));
    hintToggle.setAttribute("aria-label", hintsEnabled ? "Hide hints" : "Show hints");
    hintToggle.title = hintsEnabled ? "Hide hints" : "Show hints";
    renderBoard();
  });
  const input = document.getElementById("supokuInput") as HTMLInputElement;
  input.addEventListener("input", renderSupokuSuggestions);
  input.addEventListener("keydown", (event) => {
    const options = Array.from(
      document.querySelectorAll<HTMLElement>("#supokuSuggestions [role='option']")
    );
    if (event.key === "ArrowDown" && options.length > 0) {
      event.preventDefault();
      selectedSupokuSuggestionIndex =
        (selectedSupokuSuggestionIndex + 1) % options.length;
      updateSupokuSuggestionHighlight(options);
      return;
    }
    if (event.key === "ArrowUp" && options.length > 0) {
      event.preventDefault();
      selectedSupokuSuggestionIndex =
        selectedSupokuSuggestionIndex <= 0
          ? options.length - 1
          : selectedSupokuSuggestionIndex - 1;
      updateSupokuSuggestionHighlight(options);
      return;
    }
    if (event.key === "Escape") {
      hideSupokuSuggestions();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (selectedSupokuSuggestionIndex >= 0 && options[selectedSupokuSuggestionIndex]) {
        selectSupokuSuggestion(options[selectedSupokuSuggestionIndex].textContent ?? "");
      } else {
        submitCellGuess();
      }
    }
  });
  document.getElementById("supokuRevealBtn")!.addEventListener("click", revealBoard);
  document.getElementById("supokuCancelReveal")!.addEventListener("click", () => {
    (document.getElementById("supokuRevealConfirm") as HTMLDialogElement).close();
  });
  document.getElementById("supokuConfirmReveal")!.addEventListener("click", confirmRevealBoard);
  document.getElementById("supokuCompletionShareBtn")!.addEventListener("click", () => {
    void shareBoard().catch((error: unknown) => {
      document.getElementById("supokuFeedback")!.textContent =
        error instanceof Error ? `Could not share result: ${error.message}` : "Could not share result.";
    });
  });
  document.getElementById("supokuCompletionCloseBtn")!.addEventListener("click", () => {
    document.getElementById("supokuCompletion")!.hidden = true;
  });
  document.getElementById("supokuShareBtn")!.addEventListener("click", () => {
    void shareBoard().catch((error: unknown) => {
      document.getElementById("supokuFeedback")!.textContent =
        error instanceof Error ? `Could not share result: ${error.message}` : "Could not share result.";
    });
  });
}

export function startDailySupoku(): void {
  startTimer();
}

export function setDailySupokuDifficulty(nextDifficulty: SupokuDifficulty): void {
  difficulty = nextDifficulty;
  document.getElementById("supokuSearchRow")!.hidden = difficulty === "normal";
  document.getElementById("supokuBoxPanel")!.hidden = difficulty !== "normal";
  selectedBoxPokemonId = undefined;
  saveGame();
  renderBoard();
}
