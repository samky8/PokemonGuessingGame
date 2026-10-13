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
const cellCount = 16;

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

function dailyDate(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
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
        ? hasFirstType && !hasSecondType
        : typeCategory === 1
          ? hasSecondType && !hasFirstType
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
      new Set(entries.map((answer) => answer.generation)).size !== 4 ||
      new Set(entries.map((answer) => answer.evolutionClass)).size !== 4
    ) {
      throw new Error("The generated board does not satisfy the generation/evolution Sudoku rules.");
    }
    const typeCounts = types.map((type) =>
      entries.filter((answer) => answer.types.includes(type)).length
    );
    if (typeCounts[0] !== 1 || typeCounts[1] !== 1) {
      throw new Error("The generated board does not contain exactly one of each daily type.");
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
    state.rulesVersion !== 3 ||
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
        )))
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
}

function saveGame(): void {
  if (!puzzle) return;
  localStorage.setItem("supoku-progress", JSON.stringify({
    rulesVersion: 3,
    date: puzzle.date,
    solved: [...solvedCells],
    placements: [...placedPokemonIds.entries()],
    mistakes,
    startedAt,
    elapsedMs,
    revealed,
    revealedCorrectCells: [...revealedCorrectCells],
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
  document.getElementById("supokuSelected")!.hidden = true;
  document.getElementById("supokuStatus")!.textContent = revealed
    ? "Answers revealed. Come back tomorrow for a new puzzle."
    : "Daily board complete! Come back tomorrow for a new puzzle.";
}

function formatName(name: string): string {
  return name.split("-").map((part) =>
    part.charAt(0).toUpperCase() + part.slice(1)
  ).join(" ");
}

function renderBoard(): void {
  if (!puzzle) return;
  const board = document.getElementById("supokuBoard")!;
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
    button.disabled = isGiven || isSolved;
    const shownPokemon = pokemonById.get(placedPokemonIds.get(index) ?? -1) ?? answer;
    button.setAttribute("aria-label", `Cell ${index + 1}${isGiven || isSolved ? `, ${formatName(shownPokemon.name)}` : ", hidden answer"}`);
    if (isGiven || isSolved) {
      button.innerHTML = `
        <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${shownPokemon.id}.png" alt="" />
        <span>${formatName(shownPokemon.name)}</span>
      `;
    } else {
      button.innerHTML = `<span class="supoku-hidden">${String(index + 1).padStart(2, "0")}</span><small>Tap to select</small>`;
      button.addEventListener("click", () => {
        selectedCell = index;
        updateSelectedCell();
        renderBoard();
      });
    }
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
}

function getRuleConflicts(): Set<number> {
  if (!puzzle) return new Set();
  const currentPuzzle = puzzle;
  const conflicts = new Set<number>();
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

  for (let index = 0; index < cellCount; index++) {
    const pokemonId = placedPokemonIds.get(index);
    if (pokemonId === undefined && !currentPuzzle.givens.has(index)) continue;
    const entry = pokemonId === undefined
      ? currentPuzzle.answers[index]
      : pokemonById.get(pokemonId);
    if (!entry) continue;
    const selectedTypeCount = currentPuzzle.types.filter((type) => entry.types.includes(type)).length;
    if (selectedTypeCount > 1) conflicts.add(index);
  }

  for (const group of groups) {
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

    for (const type of currentPuzzle.types) {
      const members = entries
        .filter(({ entry }) => entry.types.includes(type))
        .map(({ index }) => index);
      if (members.length > 1) members.forEach((index) => conflicts.add(index));
      if (entries.length === 4 && members.length === 0) {
        entries.forEach(({ index }) => conflicts.add(index));
      }
    }
  }

  return conflicts;
}

function clearCell(index: number): void {
  solvedCells.delete(index);
  placedPokemonIds.delete(index);
  selectedCell = index;
  document.getElementById("supokuFeedback")!.textContent = "";
  saveGame();
  updateSelectedCell();
  renderBoard();
}

function possibleAnswers(index: number): SupokuPokemon[] {
  if (!puzzle) return [];
  const answer = puzzle.answers[index];
  const requiredType = answer.types.find((type) => puzzle!.types.includes(type));
  const otherType = puzzle.types.find((type) => type !== requiredType);
  return allDailyPokemon
    .filter((candidate) =>
      candidate.generation === answer.generation &&
      candidate.evolutionClass === answer.evolutionClass &&
      (requiredType
        ? candidate.types.includes(requiredType) &&
          !candidate.types.includes(otherType!)
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

function updateSelectedCell(): void {
  if (!puzzle || puzzle.givens.has(selectedCell) || solvedCells.has(selectedCell)) return;
  document.getElementById("supokuSelected")!.textContent =
    `Selected cell ${selectedCell + 1} · Find any Pokémon that fits its hidden categories`;
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
  solvedCells.add(selectedCell);
  placedPokemonIds.set(selectedCell, candidate.id);
  feedback.textContent = "";
  input.value = "";
  saveGame();
  const nextCell = puzzle.answers.findIndex((_, index) =>
    !puzzle!.givens.has(index) && !solvedCells.has(index)
  );
  if (nextCell !== -1) selectedCell = nextCell;
  updateSelectedCell();
  renderBoard();
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
        puzzle!.types.every((type) => guess.types.includes(type) === answer.types.includes(type));
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
  await navigator.clipboard.writeText(text);
  document.getElementById("supokuFeedback")!.textContent = "Result copied to clipboard.";
}

export function initDailySupoku(data: SupokuPokemon[], names: string[]): void {
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
  puzzle = createPuzzle(date);
  solvedCells = new Set();
  placedPokemonIds = new Map();
  mistakes = 0;
  startedAt = null;
  elapsedMs = null;
  revealed = false;
  revealedCorrectCells = new Set();
  readSavedGame(date);
  const firstUnsolved = puzzle.answers.findIndex((_, index) =>
    !puzzle!.givens.has(index) && !solvedCells.has(index)
  );
  if (firstUnsolved !== -1) selectedCell = firstUnsolved;

  document.getElementById("supokuEvolutionClasses")!.textContent =
    puzzle.evolutionClasses.map((item) => formatName(item.replace("stage", "stage "))).join(" · ");
  document.getElementById("supokuGenerations")!.textContent =
    puzzle.generations.map((generation) => `Gen ${generation}`).join(" · ");
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
  document.getElementById("supokuSearchRow")!.hidden = false;
  document.getElementById("supokuSelected")!.hidden = false;
  renderTimer();
  if (revealed || (solvedCells.size === 12 && getRuleConflicts().size === 0)) {
    finishPuzzle(revealed);
  }
  const nameOptions = document.getElementById("supokuNameOptions")!;
  names.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    nameOptions.appendChild(option);
  });
  document.getElementById("supokuInput")!.setAttribute("list", "supokuNameOptions");
  renderBoard();
  updateSelectedCell();

  document.getElementById("supokuGuessBtn")!.addEventListener("click", submitCellGuess);
  document.getElementById("supokuInput")!.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitCellGuess();
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
        error instanceof Error ? `Could not copy result: ${error.message}` : "Could not copy result.";
    });
  });
  document.getElementById("supokuCompletionCloseBtn")!.addEventListener("click", () => {
    document.getElementById("supokuCompletion")!.hidden = true;
  });
  document.getElementById("supokuShareBtn")!.addEventListener("click", () => {
    void shareBoard().catch((error: unknown) => {
      document.getElementById("supokuFeedback")!.textContent =
        error instanceof Error ? `Could not copy result: ${error.message}` : "Could not copy result.";
    });
  });
}

export function startDailySupoku(): void {
  startTimer();
}
