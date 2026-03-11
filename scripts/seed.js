const { readFile, writeFile } = require("fs/promises");
const path = require("path");

async function main() {
  const dataDir = path.join(__dirname, "..", "data");
  const samplePath = path.join(dataDir, "sample_recipes.json");
  const targetPath = path.join(dataDir, "family_meals.json");

  try {
    const sample = await readFile(samplePath, "utf8");
    await writeFile(targetPath, sample);
    console.log(
      "Seeded data/family_meals.json with sample data. Use password 'demo' to explore."
    );
  } catch (error) {
    console.error("Failed to seed data file:", error.message);
    process.exitCode = 1;
  }
}

main();
