# 🧩 Pokedle

A Pokémon guessing game inspired by Wordle/Who's That Pokémon. Built with TypeScript, Vite, and the PokéAPI.

Guess the hidden Pokémon using logic-based clues about:
- Type
- Height
- Weight
- Generation (Gen 1–3)
- Evolution stage

---

## 🎮 How to Play

1. A random Pokémon is selected (Gen 1–3 by default)
2. You have **5 guesses**
3. After each guess, you receive feedback:
   - ✅ Correct
   - 🟨 Partial match (used for dual-type)
   - ❌ Incorrect
   - ⬆️ / ⬇️ Higher or lower hints
4. Use logic + elimination to narrow down the answer

---

## 💡 Features

- Smart autocomplete search
- Dynamic “Valid Choices” counter
- Evolution-stage comparison system
- 3-tier hint system (progressively reveals clues)
- Guess history table with visual feedback
- Win / lose reveal animations
- Share results (emoji-based summary)
- Filter by Generation (Gen 1 / 2 / 3)
- Light / Dark mode
- Floating Pokémon background sprites
- Mobile-friendly layout

---

## 📦 Tech Stack

- TypeScript
- Vite
- HTML/CSS
- PokéAPI (https://pokeapi.co)

