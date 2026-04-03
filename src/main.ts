import "./style.css";

type PokemonData = {
  id: number;
  name: string;
  types: string[];
  height: number;
  weight: number;
  evolutionStage: number;
  generation: number;
};

const API = "https://pokeapi.co/api/v2/pokemon/";
let target: PokemonData;
let pokemonNames: string[] = [];
let guesses = 0;
let maxGuesses = 5;
let maxHints = 3;
let gameOver = false;
let hintsUsed = 0;
let streak = 0;
let allPokemon: PokemonData[] = [];
let guessHistory: PokemonData[] = [];
let shareResults: string[] = [];
let enabledGenerations = [1, 2, 3];
let selectedSuggestionIndex = -1;


async function loadAllPokemonData() {
  allPokemon = await Promise.all(
    Array.from({ length: 386 }, (_, i) => fetchPokemon(i + 1))
  );
}

function generationToNumber(gen: string): number {
  const map: Record<string, number> = {
    "generation-i": 1,
    "generation-ii": 2,
    "generation-iii": 3,
    "generation-iv": 4,
    "generation-v": 5,
    "generation-vi": 6,
    "generation-vii": 7,
    "generation-viii": 8,
    "generation-ix": 9,
  };
  return map[gen] ?? 0;
}

async function getEvolutionStage(species: any): Promise<number> {
  const chainRes = await fetch(species.evolution_chain.url);
  const chainData = await chainRes.json();

  const targetName = species.name;

  let stage = 1;
  let current = chainData.chain;

  // stage 1
  if (current.species.name === targetName) {
    return 1;
  }

  // stage 2 / 3+
  while (current.evolves_to.length > 0) {
    stage++;

    current = current.evolves_to[0];

    if (current.species.name === targetName) {
      return stage;
    }
  }

  return stage;
}

function initBoard() {
  const board = document.getElementById("guessBoard")!;
  board.innerHTML = "";
}

async function init(refreshSprites = true) {
  await loadPokemonNames();

  if (allPokemon.length === 0) {
    await loadAllPokemonData();
  }

  const possibleTargets = allPokemon.filter((p) =>
    enabledGenerations.includes(p.generation)
  );

  target =
    possibleTargets[
      Math.floor(Math.random() * possibleTargets.length)
    ];

  guesses = 0;
  gameOver = false;
  hintsUsed = 0;
  guessHistory = [];
  shareResults = [];

  document.getElementById("hintCount")!.textContent =
    maxHints.toString();

  document.getElementById("remainingCount")!.textContent =
    maxGuesses.toString();

  document.getElementById("validCount")!.textContent =
    possibleTargets.length.toString();

  renderValidChoices(possibleTargets);

  initBoard();

  document.getElementById("emptyState")!.style.display = "block";

  if (refreshSprites) {
    generateFloatingSprites();
  }
}

function toLbs(weightHg: number) {
  return Math.round((weightHg / 10) * 2.20462);
}

function toFeetInches(heightDm: number) {
  const totalInches = Math.round((heightDm * 3.93701));
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;

  return `${feet}'${inches}"`;
}

async function loadPokemonNames() {
  const res = await fetch("https://pokeapi.co/api/v2/pokemon?limit=386");  const data = await res.json();
  pokemonNames = data.results.map((p: any) => p.name);
}

await loadPokemonNames();

if (allPokemon.length === 0) {
  await loadAllPokemonData();
}



async function fetchPokemon(nameOrId: string | number): Promise<PokemonData> {
  const res = await fetch(`${API}${nameOrId}`);
  const data = await res.json();

  const speciesRes = await fetch(data.species.url);
  const species = await speciesRes.json();

  return {
    id: data.id,
    name: data.name,
    types: data.types.map((t: any) => t.type.name),
    height: data.height,
    weight: data.weight,
    evolutionStage: await getEvolutionStage(species),
    generation: generationToNumber(species.generation.name),  
  };
}

function compareTypes(a: string[], b: string[]) {
  if (JSON.stringify(a.sort()) === JSON.stringify(b.sort())) return "✅";
  if (a.some((t) => b.includes(t))) return "🟨";
  return "❌";
}

function compareNum(a: number, b: number) {
  if (a === b) return "✅";
  return a < b ? "⬆️" : "⬇️";
}

function compareNumSimple(a: number, b: number) {
  return a === b ? "✅" : "❌";
}

function formatPokemonName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function showMessage(
  message: string,
  type = "info",
  mediaHtml = ""
) {
  const msg = document.getElementById("message")!;

  msg.innerHTML = `
    <div>${message}</div>
    ${mediaHtml}
  `;

  msg.className = `message ${type}`;
  msg.style.display = "block";
}

function clearMessage() {
  const msg = document.getElementById("message")!;
  msg.innerHTML = "";
  msg.style.display = "none";
}

function updateValidChoices() {
  const valid = allPokemon
  .filter((p) =>
    enabledGenerations.includes(p.generation)
  )
  .filter((candidate) => {
    return guessHistory.every((guess) => {
      // Type comparison - full logic
      const typeMatch = compareTypes(guess.types, target.types) ===
        compareTypes(guess.types, candidate.types);
      
      // Height comparison - full logic
      const heightMatch = compareNum(guess.height, target.height) ===
        compareNum(guess.height, candidate.height);
      
      // Weight comparison - full logic  
      const weightMatch = compareNum(guess.weight, target.weight) ===
        compareNum(guess.weight, candidate.weight);
      
      // Evolution stage - simplified logic
      let stageMatch = true;
      const stageComparison = compareNumSimple(guess.evolutionStage, target.evolutionStage);
      if (stageComparison === "✅") {
        // If guess shows correct stage, target must have same stage
        stageMatch = guess.evolutionStage === candidate.evolutionStage;
      } else if (stageComparison === "❌") {
        // If guess shows wrong stage, target must have different stage
        stageMatch = guess.evolutionStage !== candidate.evolutionStage;
      }
      
      // Generation - simplified logic
      let genMatch = true;
      const genComparison = compareNumSimple(guess.generation, target.generation);
      if (genComparison === "✅") {
        // If guess shows correct generation, target must have same generation
        genMatch = guess.generation === candidate.generation;
      } else if (genComparison === "❌") {
        // If guess shows wrong generation, target must have different generation
        genMatch = guess.generation !== candidate.generation;
      }
      
      return typeMatch && heightMatch && weightMatch && stageMatch && genMatch;
    });
  });

  document.getElementById("validCount")!.textContent =
    valid.length.toString();

  renderValidChoices(valid);
}

function renderValidChoices(valid: PokemonData[]) {
  const countElement = document.getElementById("validChoicesCount")!;
  const listElement = document.getElementById("validChoicesList")!;

  countElement.textContent = valid.length.toString();

  listElement.innerHTML = "";

  // Sort by name for consistent display
  valid.sort((a, b) => a.name.localeCompare(b.name));

  valid.forEach((pokemon) => {
    const item = document.createElement("div");
    item.className = "valid-choice-item";

    item.innerHTML = `
      <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.id}.png"
           alt="${pokemon.name}"
           title="${formatPokemonName(pokemon.name)}" />
      <div class="valid-choice-name">${pokemon.name}</div>
      <div class="marked-overlay" style="display: none;">✕</div>
    `;

    // Left click to enter in search field
    item.addEventListener("click", () => {
      const input = document.getElementById("guessInput") as HTMLInputElement;
      input.value = pokemon.name;
      input.focus();
      clearAutocomplete();
    });

    // Right click to mark/unmark with red X
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const overlay = item.querySelector(".marked-overlay") as HTMLElement;
      const isMarked = overlay.style.display === "flex";
      overlay.style.display = isMarked ? "none" : "flex";
      item.classList.toggle("marked", !isMarked);
    });

    listElement.appendChild(item);
  });
}

async function submitGuess() {
  if (gameOver) return;

  const input = document.getElementById("guessInput") as HTMLInputElement;
  const guessName = input.value.toLowerCase().trim();

  if (!guessName) return;

  try {
    const guess = await fetchPokemon(guessName);

    renderGuess(guess);

    guesses++;
    console.log("guesses left", maxGuesses - guesses);
    guessHistory.push(guess);

    // Show the valid choices panel after first guess
    if (guesses === 1) {
      document.getElementById("validChoicesPanel")!.style.display = "block";
    }

    // always update widgets first
    document.getElementById("remainingCount")!.textContent =
      (maxGuesses - guesses).toString();

      const shareLine = `${formatPokemonName(guess.name)}: ${compareTypes(
  guess.types,
  target.types
)}${compareNum(guess.height, target.height)}${compareNum(
  guess.weight,
  target.weight
)}${compareNumSimple(guess.generation, target.generation)}${compareNumSimple(
  guess.evolutionStage,
  target.evolutionStage
)}`;

shareResults.push(shareLine);

    updateValidChoices();

    if (guess.name === target.name) {
      winGame();
      return;
    }

    if (guesses >= maxGuesses) {
      loseGame();
      return;
    }

    showMessage(`You guessed ${formatPokemonName(guess.name)}`);
  } catch {
    showMessage("❌ Pokémon not found");
  }

  input.value = "";
  clearAutocomplete();
}

function winGame() {
  gameOver = true;
  streak++;

  document.getElementById("streakCount")!.textContent =
    streak.toString();

  (document.getElementById("guessInput") as HTMLInputElement).disabled = true;
  (document.getElementById("guessBtn") as HTMLButtonElement).disabled = true;

  showMessage(
    `🎉 You caught ${target.name.toUpperCase()}!`,
    "success",
    `
      <img 
        src="https://i.pinimg.com/originals/78/59/10/785910a0a9035c124f551a132377afa4.gif"
        style="width:240px; margin-top:16px; border-radius:16px;"
      />
    `
  );

  showRestart();
}

function loseGame() {
  gameOver = true;

  (document.getElementById("guessInput") as HTMLInputElement).disabled = true;
  (document.getElementById("guessBtn") as HTMLButtonElement).disabled = true;

  showMessage(
    `💀 Out of guesses! The answer was ${target.name.toUpperCase()}`,
    "error",
    `
      <img 
        src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${target.id}.png"
        style="width:120px; margin-top:16px; image-rendering: pixelated;"
      />
    `
  );

  showRestart();
}

function showRestart() {
  document.getElementById("restartBtn")!.style.display = "inline-block";
  document.getElementById("shareBtn")!.style.display = "inline-block";
}

function restartGame() {
  guesses = 0;
  gameOver = false;
  hintsUsed = 0;
  guessHistory = [];
  shareResults = [];

  // reset widgets
  document.getElementById("remainingCount")!.textContent =
    maxGuesses.toString();
  document.getElementById("hintCount")!.textContent =
  maxHints.toString();
  // validCount will be set by init()

  // reset buttons
  document.getElementById("restartBtn")!.style.display = "none";
  document.getElementById("shareBtn")!.style.display = "none";

  // re-enable controls
  (document.getElementById("guessInput") as HTMLInputElement).disabled = false;
(document.getElementById("guessBtn") as HTMLButtonElement).disabled = false;
(document.getElementById("hintBtn") as HTMLButtonElement).disabled = false;
(document.getElementById("revealBtn") as HTMLButtonElement).disabled = false;
  // clear input
  (document.getElementById("guessInput") as HTMLInputElement).value = "";

  // reset board + empty state
  initBoard();
  document.getElementById("emptyState")!.style.display = "block";
  document.getElementById("hintsContainer")!.innerHTML = "";
  document.getElementById("hintsContainer")!.style.display = "none";
  document.getElementById("validChoicesPanel")!.style.display = "none";

  showMessage("Starting new game...");

  setTimeout(() => {
    clearMessage();
  }, 900);

  init();
}

function shareResultsText() {
  const won =
    shareResults.length > 0 &&
    shareResults[shareResults.length - 1].includes("✅✅✅✅✅");

  const header = `Who's that Pokémon?\n`;
  const body = shareResults.join("\n");

  const footer = won
  ? `\n\n🎉 Solved in ${guesses}/${maxGuesses}\nHints used: ${hintsUsed}\nAnswer: ${formatPokemonName(target.name)}`
  : `\n\n💀 Failed ${guesses}/${maxGuesses}\nAnswer: ${formatPokemonName(target.name)}`;

  const text = `${header}\n${body}${footer}`;

  if (navigator.share) {
  navigator.share({
    title: "Pokedle",
    text,
  });
} else {
  navigator.clipboard.writeText(text);
}

  navigator.clipboard.writeText(text);

  showMessage("📋 Results copied to clipboard!", "success");
}

function renderGuess(guess: PokemonData) {
  const board = document.getElementById("guessBoard")!;

  const newRow = document.createElement("tr");

  newRow.innerHTML = `
    <td>
      <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${guess.id}.png" title="${
          guess.name.charAt(0).toUpperCase() +
          guess.name.slice(1)
        }"
        alt="${guess.name}"
      />
      <div class="guess-name">${guess.name}</div>
    </td>

    <td>
      <div>${compareTypes(guess.types, target.types)}</div>
      <small>${guess.types.join(" / ")}</small>
    </td>

    <td>
      <div>${compareNum(guess.height, target.height)}</div>
      <small>${toFeetInches(guess.height)}</small>
    </td>

    <td>
      <div>${compareNum(guess.weight, target.weight)}</div>
      <small>${toLbs(guess.weight)} lbs</small>
    </td>

    <td>
      <div>${compareNumSimple(guess.evolutionStage, target.evolutionStage)}</div>
      <small>Stage ${guess.evolutionStage}</small>
    </td>

    <td>
      <div>${compareNumSimple(guess.generation, target.generation)}</div>
      <small>Gen ${guess.generation}</small>
    </td>
  `;

  document.getElementById("emptyState")!.style.display = "none";

  board.prepend(newRow);

  while (board.children.length > maxGuesses) {
    board.removeChild(board.lastChild!);
  }
}

function setupAutocomplete() {
  const input = document.getElementById("guessInput") as HTMLInputElement;
  const suggestions = document.getElementById("suggestions")!;

  input.addEventListener("input", () => {
  const value = input.value.toLowerCase();

  suggestions.innerHTML = "";

  // reset arrow selection whenever user types
  selectedSuggestionIndex = -1;

  if (!value) return;

  pokemonNames
    .filter((name) => name.startsWith(value))
    .slice(0, 5)
    .forEach((name) => {
      const div = document.createElement("div");
      div.className = "suggestion";
      div.textContent = name;

      div.onclick = () => {
        input.value = name;
        clearAutocomplete();
      };

      suggestions.appendChild(div);
    });
});

input.addEventListener("keydown", (e) => {
  const suggestionElements = Array.from(
    document.querySelectorAll(".suggestion")
  ) as HTMLElement[];

  if (!suggestionElements.length) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitGuess();
    }
    return;
  }

  // down arrow
  if (e.key === "ArrowDown") {
    e.preventDefault();

    selectedSuggestionIndex =
      (selectedSuggestionIndex + 1) %
      suggestionElements.length;

    updateSuggestionHighlight(suggestionElements);
    return;
  }

  // up arrow
  if (e.key === "ArrowUp") {
    e.preventDefault();

    selectedSuggestionIndex =
      selectedSuggestionIndex <= 0
        ? suggestionElements.length - 1
        : selectedSuggestionIndex - 1;

    updateSuggestionHighlight(suggestionElements);
    return;
  }

  // enter selects highlighted
  if (e.key === "Enter") {
    e.preventDefault();

    if (selectedSuggestionIndex >= 0) {
      input.value =
        suggestionElements[selectedSuggestionIndex].textContent || "";
      clearAutocomplete();
      selectedSuggestionIndex = -1;
    }

    submitGuess();
    return;
  }
});
}

function updateSuggestionHighlight(elements: HTMLElement[]) {
  elements.forEach((el, index) => {
    el.classList.toggle(
      "selected",
      index === selectedSuggestionIndex
    );
  });
}

function toggleSettings() {
  const panel = document.getElementById("settingsPanel")!;

  const isOpen = getComputedStyle(panel).display !== "none";

  panel.style.display = isOpen ? "none" : "flex";
}

function updateGenerationFilters() {
  enabledGenerations = [];

  if ((document.getElementById("gen1") as HTMLInputElement).checked) {
    enabledGenerations.push(1);
  }

  if ((document.getElementById("gen2") as HTMLInputElement).checked) {
    enabledGenerations.push(2);
  }

  if ((document.getElementById("gen3") as HTMLInputElement).checked) {
    enabledGenerations.push(3);
  }

  // prevent empty selection
  if (enabledGenerations.length === 0) {
    enabledGenerations = [1];
    (document.getElementById("gen1") as HTMLInputElement).checked = true;
  }

  // update valid choices immediately
  const validChoices = allPokemon.filter((p) =>
    enabledGenerations.includes(p.generation)
  );

  // reset game state
  guesses = 0;
  gameOver = false;
  hintsUsed = 0;
  guessHistory = [];
  shareResults = [];

  // reset widgets
  document.getElementById("remainingCount")!.textContent =
    maxGuesses.toString();
  document.getElementById("hintCount")!.textContent =
    maxHints.toString();
  document.getElementById("validCount")!.textContent =
    validChoices.length.toString();

  renderValidChoices(validChoices);

  // reset buttons
  document.getElementById("restartBtn")!.style.display = "none";
  document.getElementById("shareBtn")!.style.display = "none";

  // re-enable controls
  (document.getElementById("guessInput") as HTMLInputElement).disabled = false;
  (document.getElementById("guessBtn") as HTMLButtonElement).disabled = false;
  (document.getElementById("hintBtn") as HTMLButtonElement).disabled = false;
  (document.getElementById("revealBtn") as HTMLButtonElement).disabled = false;

  // clear input
  (document.getElementById("guessInput") as HTMLInputElement).value = "";

  // reset board + empty state
  initBoard();
  document.getElementById("emptyState")!.style.display = "block";
  document.getElementById("hintsContainer")!.innerHTML = "";
  document.getElementById("hintsContainer")!.style.display = "none";
  document.getElementById("validChoicesPanel")!.style.display = "none";

  showMessage("Settings updated, starting new game...");

  setTimeout(() => {
    clearMessage();
  }, 900);

  init(false); // preserve current floating sprites when generation changes
}

function clearAutocomplete() {
  document.getElementById("suggestions")!.innerHTML = "";
}

function showHint() {
  if (gameOver) return;

  if (hintsUsed >= maxHints) {
    showMessage("⚠️ No hints remaining", "error");
    return;
  }

  hintsUsed++;

  document.getElementById("hintCount")!.textContent =
  (maxHints - hintsUsed).toString();

  let hintMessage = "";

  switch (hintsUsed) {
    case 1:
      hintMessage = `💡 Hint 1: Type = ${target.types.join(", ")}`;
      break;

    case 2:
      hintMessage = `💡 Hint 2: Weight = ${toLbs(target.weight)} lbs`;
      break;

    case 3:
      hintMessage = `💡 Hint 3: Starts with "${target.name[0].toUpperCase()}"`;
      break;
  }

  const hintsContainer = document.getElementById("hintsContainer")!;
  hintsContainer.style.display = "block";
  
  const hintDiv = document.createElement("div");
  hintDiv.className = "message info";
  hintDiv.innerHTML = `<div>${hintMessage}</div>`;
  hintsContainer.appendChild(hintDiv);

  // disable button after last hint
  if (hintsUsed >= maxHints) {
    (
      document.getElementById("hintBtn") as HTMLButtonElement
    ).disabled = true;
  }
}

function revealAnswer() {
  if (gameOver) return;

  gameOver = true;

  // disable controls
  (document.getElementById("guessInput") as HTMLInputElement).disabled = true;
  (document.getElementById("guessBtn") as HTMLButtonElement).disabled = true;
  (document.getElementById("hintBtn") as HTMLButtonElement).disabled = true;
  (document.getElementById("revealBtn") as HTMLButtonElement).disabled = true;

  showMessage(
    `🎯 The answer was ${target.name.toUpperCase()}`,
    "success",
    `
      <img 
        src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${target.id}.png"
        alt="${target.name}"
        style="width:120px; margin-top:16px; image-rendering: pixelated;"
      />
    `
  );

  showRestart();
}

function toggleTheme() {
  document.body.classList.toggle("light-theme");

  const isLight = document.body.classList.contains("light-theme");
  const themeBtn = document.getElementById("themeBtn")!;

  themeBtn.textContent = isLight ? "🌙": "☀️";
}
document.querySelector("#app")!.innerHTML = `
  <div class="navbar">
  <div class="nav-left">
    <img 
      src="https://static.wikia.nocookie.net/pokemon-fano/images/6/6f/Poke_Ball.png"
      class="nav-logo"
      alt="Pokeball"
    />
    <span class="nav-title">Who's that Pokémon?</span>
  </div>

  <div class="nav-right">
    <button id="themeBtn" class="nav-btn">🌙</button>

    <div class="settings-wrapper">
      <button id="settingsBtn" class="nav-btn">⚙️</button>

      <div id="settingsPanel" class="settings-panel" style="display:none;">
        <div class="setting-item">
          <input type="checkbox" id="gen1" checked />
          <label for="gen1">Gen 1</label>
        </div>
        <div class="setting-item">
          <input type="checkbox" id="gen2" checked />
          <label for="gen2">Gen 2</label>
        </div>
        <div class="setting-item">
          <input type="checkbox" id="gen3" checked />
          <label for="gen3">Gen 3</label>
        </div>
      </div>
    </div>
  </div>
</div>

  <div class="container">

<div class="top-bar">
  <div class="stat-card">
    <div id="remainingCount" class="stat-number">5</div>
    <div class="stat-label">Guesses left</div>
  </div>

  <div class="stat-card">
    <div id="validCount" class="stat-number">386</div>
    <div class="stat-label">Valid choices</div>
  </div>

  <div class="stat-card">
    <div id="streakCount" class="stat-number">0</div>
    <div class="stat-label">Streak</div>
  </div>

  <div class="stat-card">
    <div id="hintCount" class="stat-number">3</div>
    <div class="stat-label">Hints left</div>
  </div>
</div>

<div class="game-card">
  <div id="floatingSprites" class="floating-sprites"></div>
  <h1 class="title">Who's that Pokémon?</h1>

      <div class="search-row">
        <div class="search-wrapper">
          <input id="guessInput" placeholder="Search Pokémon..." />
          <button id="guessBtn">Guess</button>
        </div>
        <div id="suggestions"></div>
      </div>

      <div class="button-row">
        <button id="hintBtn">Hint</button>
        <button id="revealBtn">Reveal</button>
        <button id="restartBtn" style="display:none;">Play again</button>
        <button id="shareBtn" style="display:none;">Share</button>
      </div>

      <div id="message" style="display: none;"></div>

      <div id="hintsContainer" style="display:none;"></div>

      <table class="guess-table">
        <thead>
          <tr>
            <th>Sprite</th>
            <th>Type</th>
            <th>Height</th>
            <th>Weight</th>
            <th>Evolution</th>
            <th>Generation</th>
          </tr>
        </thead>
        <tbody id="guessBoard"></tbody>
      </table>

      <div class="accordion-panel" id="validChoicesPanel" style="display: none;">
        <button class="accordion-toggle" id="validChoicesToggle">
          <span class="accordion-icon">▶</span>
          Valid choices remaining (<span id="validChoicesCount">0</span>)
        </button>
        <div class="accordion-content" id="validChoicesContent">
          <div id="validChoicesList" class="valid-choices-list"></div>
        </div>
      </div>

      <div id="emptyState" class="empty-state">
      Start guessing to reveal clues
      </div>

    </div>
  </div>
`;

function generateFloatingSprites() {
  const container = document.getElementById("floatingSprites");

  if (!container) return;

  container.innerHTML = "";

  const positions = [
    { top: "16px", left: "16px" },
    { top: "16px", right: "16px" },
    { bottom: "16px", left: "16px" },
    { bottom: "16px", right: "16px" },
  ];

  positions.forEach((pos) => {
  const pokemon =
    allPokemon[Math.floor(Math.random() * allPokemon.length)];

  const displayName =
    pokemon.name.charAt(0).toUpperCase() +
    pokemon.name.slice(1);

  const img = document.createElement("img");

  img.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.id}.png`;

  img.className = "floating-sprite";

  img.setAttribute("title", displayName);
  img.setAttribute("alt", displayName);

  img.onerror = () => {
    img.src =
      "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png";
  };

  Object.entries(pos).forEach(([key, value]) => {
    img.style.setProperty(key, value);
  });

  container.appendChild(img);
});
}

document
  .getElementById("settingsBtn")!
  .addEventListener("click", toggleSettings);

["gen1", "gen2", "gen3"].forEach((id) => {
  document
    .getElementById(id)!
    .addEventListener("change", updateGenerationFilters);
});

document.addEventListener("click", (e) => {
  const panel = document.getElementById("settingsPanel")!;
  const button = document.getElementById("settingsBtn")!;

  const target = e.target as Node;

  if (
    panel.style.display === "flex" &&
    !panel.contains(target) &&
    !button.contains(target)
  ) {
    panel.style.display = "none";
  }
});

document
  .getElementById("shareBtn")!
  .addEventListener("click", shareResultsText);

document.getElementById("guessBtn")!.addEventListener("click", submitGuess);
document.getElementById("hintBtn")!.addEventListener("click", showHint);
document.getElementById("revealBtn")!.addEventListener("click", revealAnswer);
document.getElementById("themeBtn")!.addEventListener("click", toggleTheme);
document.getElementById("restartBtn")!
  .addEventListener("click", restartGame);

document.getElementById("validChoicesToggle")!.addEventListener("click", () => {
  const panel = document.querySelector(".accordion-panel")!;
  panel.classList.toggle("open");
});

setupAutocomplete();
init();