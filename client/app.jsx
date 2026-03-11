/* global React, ReactDOM, html2canvas */
const { useState, useEffect, useMemo, useCallback, useRef } = React;

const api = {
  async createSession(password, { createIfMissing = false } = {}) {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, createIfMissing }),
    });
    return handleJsonResponse(response);
  },

  async fetchRecipes(token) {
    const response = await fetch("/api/recipes", {
      headers: { "X-Access-Token": token },
    });
    return handleJsonResponse(response);
  },

  async parseRecipe(payload) {
    const response = await fetch("/api/parse-recipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return handleJsonResponse(response);
  },

  async addRecipe(token, recipe) {
    const response = await fetch("/api/recipes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Access-Token": token,
      },
      body: JSON.stringify(recipe),
    });
    return handleJsonResponse(response);
  },

  async updateRecipe(token, id, recipe) {
    const response = await fetch(`/api/recipes/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Access-Token": token,
      },
      body: JSON.stringify(recipe),
    });
    return handleJsonResponse(response);
  },

  async deleteRecipe(token, id) {
    const response = await fetch(`/api/recipes/${id}`, {
      method: "DELETE",
      headers: { "X-Access-Token": token },
    });
    if (response.status === 204) {
      return { success: true };
    }
    return handleJsonResponse(response);
  },

  async previewShoppingList(token, payload) {
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers["X-Access-Token"] = token;
    }
    const body =
      Array.isArray(payload) && payload.every((item) => typeof item === "string")
        ? { recipeIds: payload }
        : Array.isArray(payload)
        ? { recipes: payload }
        : payload || {};
    const response = await fetch("/api/shopping-list/preview", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return handleJsonResponse(response);
  },

  async exportShoppingList(items) {
    const response = await fetch("/api/shopping-list/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    return handleJsonResponse(response);
  },
};

async function handleJsonResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error || data.message || "Unexpected error occurred";
    throw new Error(message);
  }
  return data;
}

let tesseractLoader = null;

function ensureTesseract() {
  if (window.Tesseract) {
    return Promise.resolve(window.Tesseract);
  }
  if (!tesseractLoader) {
    tesseractLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      script.async = true;
      script.onload = () => {
        if (window.Tesseract) {
          resolve(window.Tesseract);
        } else {
          reject(new Error("Failed to initialize OCR engine."));
        }
      };
      script.onerror = () => {
        reject(new Error("Unable to load Tesseract.js. Check your connection and try again."));
      };
      document.head.appendChild(script);
    });
  }
  return tesseractLoader;
}

async function recognizeImageFile(file, { onProgress } = {}) {
  const Tesseract = await ensureTesseract();
  const { data } = await Tesseract.recognize(file, "eng", {
    logger: (message) => {
      if (onProgress && typeof onProgress === "function") {
        if (message.status === "recognizing text" && typeof message.progress === "number") {
          onProgress(message.progress);
        }
      }
    },
  });
  return data?.text || "";
}

function normalizeCategories(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0);
  }
  return String(value)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

function formatQuantity(quantity, unit) {
  if (quantity === null || typeof quantity === "undefined") {
    return unit ? `(${unit})` : "";
  }
  const numeric =
    typeof quantity === "number" ? quantity : Number.parseFloat(quantity);
  if (Number.isNaN(numeric)) {
    return `${quantity}${unit ? ` ${unit}` : ""}`;
  }
  const rounded = Math.round(numeric * 100) / 100;
  const formatted = rounded.toFixed(2).replace(/\.?0+$/, "");
  return `${formatted}${unit ? ` ${unit}` : ""}`;
}

function formatIngredientLine(item) {
  const amount = formatQuantity(item.quantity, item.unit);
  if (amount) {
    return `${amount} ${item.ingredient}`.trim();
  }
  return item.ingredient || item.original;
}

function downloadBlob(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}

function formatIngredientDraft(ingredients) {
  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return "";
  }
  return ingredients
    .map((item) => {
      if (item?.original) return item.original;
      return formatIngredientLine(item);
    })
    .join("\n");
}

function formatStepDraft(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return "";
  return steps.join("\n");
}

function splitNutritionLineClient(line) {
  const trimmed = line.trim();
  if (!trimmed) return { label: "", value: "" };
  const colonIndex = trimmed.indexOf(":");
  if (colonIndex !== -1) {
    return {
      label: trimmed.slice(0, colonIndex).trim(),
      value: trimmed.slice(colonIndex + 1).trim(),
    };
  }
  const dashMatch = trimmed.match(/^(.+?)[\s\-–—]+\s*(.+)$/);
  if (dashMatch) {
    return { label: dashMatch[1].trim(), value: dashMatch[2].trim() };
  }
  const caloriesMatch = trimmed.match(/^(\d+\s*(?:calories|kcal|cal).*)$/i);
  if (caloriesMatch) {
    return { label: "Calories", value: caloriesMatch[1] };
  }
  return { label: "", value: trimmed };
}

function formatNutritionDraft(items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return items
    .map((item) => {
      const label = item?.label?.trim();
      const value = item?.value?.trim();
      if (label && value) return `${label}: ${value}`;
      return value || label || "";
    })
    .filter((line) => line.length > 0)
    .join("\n");
}

function parseNutritionLines(value, previous = []) {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.map((line, index) => {
    const existing = previous[index];
    const { label, value: parsedValue } = splitNutritionLineClient(line);
    const id =
      existing?.id ||
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `nutrition-${Date.now()}-${index}`);
    return {
      id,
      label: label || "",
      value: parsedValue || "",
    };
  });
}

function App() {
  const [token, setToken] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeRecipe, setActiveRecipe] = useState(null);
  const [modalState, setModalState] = useState(null);
  const [selectedForPlan, setSelectedForPlan] = useState(new Set());
  const [filters, setFilters] = useState({
    query: "",
    ingredient: "",
    category: "all",
  });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const data = await api.fetchRecipes(token);
        if (!cancelled) {
          setRecipes(data.recipes || []);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(err.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const categories = useMemo(() => {
    const set = new Set();
    recipes.forEach((recipe) => {
      (recipe.categories || []).forEach((cat) => set.add(cat));
    });
    return Array.from(set).sort();
  }, [recipes]);

  const filteredRecipes = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    const ingredientQuery = filters.ingredient.trim().toLowerCase();
    const category = filters.category;
    return recipes.filter((recipe) => {
      const matchesCategory =
        category === "all" ||
        (recipe.categories || []).includes(category.toLowerCase());
      const matchesQuery =
        query.length === 0 ||
        recipe.name?.toLowerCase().includes(query) ||
        recipe.url?.toLowerCase().includes(query);
      const ingredientMatch =
        ingredientQuery.length === 0 ||
        (recipe.ingredients || []).some((item) =>
          item.original?.toLowerCase().includes(ingredientQuery)
        );
      return matchesCategory && matchesQuery && ingredientMatch;
    });
  }, [recipes, filters]);

  const handleAuthenticated = (session) => {
    setToken(session.token);
    setRecipes(session.recipes || []);
    setError(null);
  };

  const handleAddParsedRecipe = async (recipe) => {
    try {
      setLoading(true);
      const payload = {
        ...recipe,
        categories: normalizeCategories(recipe.categories),
      };
      const result = await api.addRecipe(token, payload);
      setRecipes((prev) => [...prev, result.recipe]);
      setModalState(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRecipe = async (id, updated) => {
    try {
      setLoading(true);
      const clean = {
        ...updated,
        categories: normalizeCategories(updated.categories),
      };
      const result = await api.updateRecipe(token, id, clean);
      setRecipes((prev) =>
        prev.map((recipe) => (recipe.id === id ? result.recipe : recipe))
      );
      setModalState(null);
      setActiveRecipe(result.recipe);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRecipe = async (id) => {
    if (!window.confirm("Remove this recipe from your favorites?")) return;
    try {
      setLoading(true);
      await api.deleteRecipe(token, id);
      setRecipes((prev) => prev.filter((recipe) => recipe.id !== id));
      setSelectedForPlan((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (activeRecipe?.id === id) {
        setActiveRecipe(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (recipeId) => {
    setSelectedForPlan((prev) => {
      const next = new Set(prev);
      if (next.has(recipeId)) {
        next.delete(recipeId);
      } else {
        next.add(recipeId);
      }
      return next;
    });
  };

  const selectedRecipes = useMemo(
    () => recipes.filter((recipe) => selectedForPlan.has(recipe.id)),
    [recipes, selectedForPlan]
  );

  const shoppingList = useShoppingList(token, selectedRecipes);

  const logout = () => {
    setToken(null);
    setRecipes([]);
    setSelectedForPlan(new Set());
    setActiveRecipe(null);
  };

  const handleUpdateRecipeSections = async (id, partial) => {
    const current = recipes.find((recipe) => recipe.id === id);
    if (!current) {
      throw new Error("Recipe not found in your list.");
    }
    try {
      setLoading(true);
      setError(null);
      const merged = { ...current, ...partial };
      const normalized = {
        ...merged,
        categories: normalizeCategories(merged.categories),
      };
      const result = await api.updateRecipe(token, id, normalized);
      setRecipes((prev) =>
        prev.map((recipe) => (recipe.id === id ? result.recipe : recipe))
      );
      setActiveRecipe(result.recipe);
      setModalState((prev) => {
        if (!prev) return prev;
        if (prev.type === "detail" && prev.recipe?.id === id) {
          return { ...prev, recipe: result.recipe };
        }
        return prev;
      });
      return result.recipe;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return <LoginView onAuthenticated={handleAuthenticated} setError={setError} />;
  }

  return (
    <div className="app-shell">
      {loading && (
        <div className="loading-overlay">Working… Hang tight.</div>
      )}
      <header className="app-header">
        <div>
          <h1>Family Meal Planner</h1>
          <small>
            {recipes.length} recipe{recipes.length === 1 ? "" : "s"} saved
          </small>
        </div>
        <div className="header-actions">
          <button
            className="secondary-button"
            onClick={() => setModalState({ type: "mealPlan" })}
            disabled={selectedRecipes.length === 0}
          >
            Meal Planner ({selectedRecipes.length})
          </button>
          <button
            className="primary-button"
            onClick={() => setModalState({ type: "add" })}
          >
            Add Recipe
          </button>
          <button className="secondary-button" onClick={logout}>
            Sign Out
          </button>
        </div>
      </header>

      <main className="content">
        <aside className="sidebar">
          <div className="sidebar-section">
            <h2>Search</h2>
            <input
              className="filter-input"
              value={filters.query}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, query: event.target.value }))
              }
              placeholder="Find by name or source"
            />
          </div>
          <div className="sidebar-section">
            <h2>Ingredient</h2>
            <input
              className="filter-input"
              value={filters.ingredient}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  ingredient: event.target.value,
                }))
              }
              placeholder="Filter by ingredient"
            />
          </div>
          <div className="sidebar-section">
            <h2>Categories</h2>
            <div className="category-list">
              <CategoryChip
                label="All"
                active={filters.category === "all"}
                onClick={() =>
                  setFilters((prev) => ({ ...prev, category: "all" }))
                }
              />
              {categories.map((category) => (
                <CategoryChip
                  key={category}
                  label={category}
                  active={filters.category === category}
                  onClick={() =>
                    setFilters((prev) => ({ ...prev, category }))
                  }
                />
              ))}
            </div>
          </div>
          <div className="sidebar-section">
            <h2>Meal Plan</h2>
            <p>
              Select recipes to include in the shopping list using the checkboxes
              on each card.
            </p>
            <button
              className="primary-button"
              disabled={selectedRecipes.length === 0}
              onClick={() => setModalState({ type: "mealPlan" })}
            >
              Build Shopping List
            </button>
          </div>
          {error && <div className="error-banner">{error}</div>}
        </aside>
        <section className="main-panel">
          {filteredRecipes.length === 0 ? (
            <div className="empty-state">
              <strong>No recipes found.</strong>
              <p>Try another search term or add a new recipe to get started.</p>
            </div>
          ) : (
            <div className="recipes-grid">
              {filteredRecipes.map((recipe) => (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  selected={selectedForPlan.has(recipe.id)}
                  onToggleSelect={() => toggleSelection(recipe.id)}
                  onView={() => {
                    setActiveRecipe(recipe);
                    setModalState({ type: "detail", recipe });
                  }}
                  onEdit={() => setModalState({ type: "edit", recipe })}
                  onDelete={() => handleDeleteRecipe(recipe.id)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {modalState?.type === "add" && (
        <RecipeCaptureModal
          onClose={() => setModalState(null)}
          onSave={handleAddParsedRecipe}
        />
      )}

      {modalState?.type === "edit" && (
        <RecipeEditorModal
          recipe={modalState.recipe}
          onClose={() => setModalState(null)}
          onSave={(updated) => handleUpdateRecipe(modalState.recipe.id, updated)}
        />
      )}

      {modalState?.type === "detail" && (
        <RecipeDetailModal
          recipe={modalState.recipe}
          onClose={() => setModalState(null)}
          onEditFull={() => setModalState({ type: "edit", recipe: modalState.recipe })}
          onUpdateSections={(id, changes) =>
            handleUpdateRecipeSections(id, changes)
          }
        />
      )}

      {modalState?.type === "mealPlan" && (
        <MealPlannerModal
          recipes={selectedRecipes}
          shoppingList={shoppingList}
          onClose={() => setModalState(null)}
        />
      )}
    </div>
  );
}

function LoginView({ onAuthenticated, setError }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const authenticate = async (createIfMissing = false) => {
    if (!password.trim()) {
      setError?.("Enter a password to access your list.");
      return;
    }
    try {
      setLoading(true);
      setError?.(null);
      const session = await api.createSession(password.trim(), {
        createIfMissing,
      });
      onAuthenticated(session);
    } catch (err) {
      setError?.(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <div className="login-card">
        <h1>Family Meal Planner</h1>
        <p>
          Enter your family password to access saved recipes, plan meals, and build
          smart shopping lists.
        </p>
        <input
          className="text-input"
          type="password"
          placeholder="Family password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <div className="login-actions">
          <button
            className="primary-button"
            onClick={() => authenticate(false)}
            disabled={loading}
          >
            Unlock favorites
          </button>
          <button
            className="secondary-button"
            onClick={() => authenticate(true)}
            disabled={loading}
          >
            Create new list
          </button>
        </div>
        {loading && <small>Connecting…</small>}
      </div>
    </div>
  );
}

function CategoryChip({ label, active, onClick }) {
  return (
    <span
      className={`category-chip ${active ? "active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      {label}
    </span>
  );
}

function RecipeCard({
  recipe,
  selected,
  onToggleSelect,
  onView,
  onEdit,
  onDelete,
}) {
  const tags = recipe.categories || [];
  return (
    <article className="recipe-card">
      <header>
        <h3>{recipe.name || "Untitled Recipe"}</h3>
        <input
          type="checkbox"
          className="checkbox"
          checked={selected}
          onChange={onToggleSelect}
        />
      </header>
      {recipe.url && <small>{recipe.url}</small>}
      <div className="recipe-tags">
        {tags.length === 0 ? (
          <span className="tag-pill">uncategorized</span>
        ) : (
          tags.map((tag) => (
            <span key={tag} className="tag-pill">
              {tag}
            </span>
          ))
        )}
      </div>
      <div className="recipe-actions">
        <button className="secondary-button" onClick={onView}>
          View Details
        </button>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="secondary-button" onClick={onEdit}>
            Edit
          </button>
          <button className="danger-button" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <header>
          <h2>{title}</h2>
          <button className="secondary-button" onClick={onClose}>
            Close
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function RecipeCaptureModal({ onClose, onSave }) {
  const [step, setStep] = useState("input");
  const [importMode, setImportMode] = useState("url");
  const [url, setUrl] = useState("");
  const [recipeText, setRecipeText] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const [ocrProgress, setOcrProgress] = useState(null);

  useEffect(() => {
    if (!imagePreview) return undefined;
    return () => URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  const resetImageSelection = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
    setOcrProgress(null);
    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
    }
    if (galleryInputRef.current) {
      galleryInputRef.current.value = "";
    }
  }, [cameraInputRef, galleryInputRef]);

  const changeMode = useCallback(
    (mode) => {
      setImportMode(mode);
      setError(null);
      if (mode !== "photo") {
        resetImageSelection();
      }
    },
    [resetImageSelection]
  );

  const handleImageChange = useCallback(
    (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) {
        resetImageSelection();
        return;
      }
      if (!file.type.startsWith("image/")) {
        setError("Choose an image file (JPEG, PNG, or HEIC).");
        resetImageSelection();
        return;
      }
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
      setError(null);
    },
    [resetImageSelection]
  );

  const openCameraPicker = useCallback(() => {
    if (cameraInputRef.current) {
      cameraInputRef.current.click();
    }
  }, [cameraInputRef]);

  const openGalleryPicker = useCallback(() => {
    if (galleryInputRef.current) {
      galleryInputRef.current.click();
    }
  }, [galleryInputRef]);

  const parseSource = async () => {
    const trimmedUrl = url.trim();
    const trimmedText = recipeText.trim();
    if (importMode === "url" && !trimmedUrl) {
      setError("Paste a recipe URL to continue.");
      return;
    }
    if (importMode === "text" && !trimmedText) {
      setError("Paste or type the recipe text to continue.");
      return;
    }
    if (importMode === "photo" && !imageFile) {
      setError("Snap or upload a recipe photo before scanning.");
      return;
    }
    try {
      setBusy(true);
      setError(null);
      if (importMode === "photo") {
        setOcrProgress(0);
      } else {
        setOcrProgress(null);
      }
      let parsed;
      if (importMode === "photo") {
        const ocrText = await recognizeImageFile(imageFile, {
          onProgress: (progress) => setOcrProgress(progress),
        });
        if (!ocrText || !ocrText.trim()) {
          setError("We couldn't read any text from that photo. Try better lighting or crop closer.");
          setOcrProgress(null);
          return;
        }
        parsed = await api.parseRecipe({ text: ocrText });
      } else {
        const payload =
          importMode === "url" ? { url: trimmedUrl } : { text: trimmedText };
        parsed = await api.parseRecipe(payload);
      }
      setDraft({
        name: parsed.name || "",
        url: parsed.url || (importMode === "url" ? trimmedUrl : ""),
        categories: parsed.categories || [],
        ingredients: parsed.ingredients || [],
        steps: parsed.steps || [],
        nutrition: parsed.nutrition || [],
        notes: "",
        source: parsed.author || "",
      });
      setStep("edit");
    } catch (err) {
      setError(err.message);
    } finally {
      setOcrProgress(null);
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Add Recipe" onClose={onClose}>
      {step === "input" && (
        <div className="field-group">
          <label>Import Source</label>
          <div className="mode-toggle">
            <button
              type="button"
              className={`mode-button ${importMode === "url" ? "active" : ""}`}
              onClick={() => changeMode("url")}
            >
              From URL
            </button>
            <button
              type="button"
              className={`mode-button ${importMode === "text" ? "active" : ""}`}
              onClick={() => changeMode("text")}
            >
              Paste Text
            </button>
            <button
              type="button"
              className={`mode-button ${importMode === "photo" ? "active" : ""}`}
              onClick={() => changeMode("photo")}
            >
              Scan Photo
            </button>
          </div>
          {importMode === "url" ? (
            <>
              <label>Recipe URL</label>
              <input
                className="text-input"
                placeholder="https://example.com/great-recipe"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </>
          ) : importMode === "text" ? (
            <>
              <label>Recipe Text</label>
              <textarea
                className="textarea"
                placeholder={
                  "Copy and paste a recipe with headings like:\nIngredients\n1 cup flour\n...\nDirections\nStep 1..."
                }
                value={recipeText}
                onChange={(event) => setRecipeText(event.target.value)}
                rows={10}
              />
            </>
          ) : (
            <>
              <div className="photo-uploader">
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageChange}
                  style={{ display: "none" }}
                />
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  style={{ display: "none" }}
                />
                {imagePreview ? (
                  <>
                    <img
                      src={imagePreview}
                      alt="Recipe preview"
                      className="photo-preview-image"
                    />
                    <div className="photo-actions">
                      <button
                        type="button"
                        className="primary-button"
                        onClick={openCameraPicker}
                      >
                        Take new photo
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={openGalleryPicker}
                      >
                        Choose from library
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={resetImageSelection}
                      >
                        Remove photo
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="photo-placeholder-text">
                      Snap a clear picture of the recipe or pick one from your photo library.
                    </p>
                    <div className="photo-actions">
                      <button
                        type="button"
                        className="primary-button"
                        onClick={openCameraPicker}
                      >
                        Take photo
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={openGalleryPicker}
                      >
                        Choose from library
                      </button>
                    </div>
                  </>
                )}
                <small className="photo-note">
                  Photos stay on this device; only the recognised text is sent to your recipe list.
                </small>
              </div>
            </>
          )}
          <div className="export-actions">
            <button
              className="primary-button"
              onClick={parseSource}
              disabled={busy}
            >
              {importMode === "photo" ? "Scan photo" : "Parse recipe"}
            </button>
          </div>
        </div>
      )}
      {step === "edit" && draft && (
        <RecipeForm
          draft={draft}
          onChange={setDraft}
          onSave={() => onSave(draft)}
          primaryLabel="Save to favorites"
        />
      )}
      {error && <div className="error-banner">{error}</div>}
      {busy && (
        <small>
          {importMode === "photo" && typeof ocrProgress === "number"
            ? `Scanning photo… ${Math.round(ocrProgress * 100)}%`
            : "Parsing recipe…"}
        </small>
      )}
    </ModalShell>
  );
}

function RecipeEditorModal({ recipe, onClose, onSave }) {
  const [draft, setDraft] = useState(() => ({
    ...recipe,
    categories: recipe.categories || [],
  }));

  return (
    <ModalShell title="Edit Recipe" onClose={onClose}>
      <RecipeForm
        draft={draft}
        onChange={setDraft}
        onSave={() => onSave(draft)}
        primaryLabel="Save changes"
      />
    </ModalShell>
  );
}

function RecipeForm({ draft, onChange, onSave, primaryLabel }) {
  const [error, setError] = useState(null);
  const [nutritionDraftText, setNutritionDraftText] = useState(() =>
    formatNutritionDraft(draft.nutrition)
  );

  useEffect(() => {
    setNutritionDraftText(formatNutritionDraft(draft.nutrition));
  }, [draft.nutrition]);

  const updateField = (field, value) => {
    onChange((prev) => ({ ...prev, [field]: value }));
  };

  const updateIngredient = (index, field, value) => {
    onChange((prev) => {
      const updated = [...(prev.ingredients || [])];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, ingredients: updated };
    });
  };

  const addIngredient = () => {
    onChange((prev) => ({
      ...prev,
      ingredients: [
        ...(prev.ingredients || []),
        {
          id: crypto.randomUUID(),
          original: "",
          quantity: null,
          unit: null,
          ingredient: "",
          notes: "",
        },
      ],
    }));
  };

  const removeIngredient = (index) => {
    onChange((prev) => {
      const updated = [...(prev.ingredients || [])];
      updated.splice(index, 1);
      return { ...prev, ingredients: updated };
    });
  };

  const addStep = () => {
    onChange((prev) => ({
      ...prev,
      steps: [...(prev.steps || []), ""],
    }));
  };

  const removeStep = (index) => {
    onChange((prev) => {
      const updated = [...(prev.steps || [])];
      updated.splice(index, 1);
      return { ...prev, steps: updated };
    });
  };

  const submit = () => {
    if (!draft.name?.trim()) {
      setError("Give this recipe a name before saving.");
      return;
    }
    setError(null);
    onSave();
  };

  return (
    <div className="field-group">
      <label>Name</label>
      <input
        className="text-input"
        value={draft.name || ""}
        onChange={(event) => updateField("name", event.target.value)}
      />
      <label>Source URL (optional)</label>
      <input
        className="text-input"
        value={draft.url || ""}
        onChange={(event) => updateField("url", event.target.value)}
      />
      <label>Categories (comma separated)</label>
      <input
        className="text-input"
        value={(draft.categories || []).join(", ")}
        onChange={(event) =>
          updateField("categories", event.target.value.split(","))
        }
      />
      <label>Ingredients</label>
      {(draft.ingredients || []).map((ingredient, index) => (
        <div
          key={ingredient.id || index}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr) auto",
            gap: "0.5rem",
            marginBottom: "0.5rem",
          }}
        >
          <input
            className="text-input"
            placeholder="Original line"
            value={ingredient.original || ""}
            onChange={(event) =>
              updateIngredient(index, "original", event.target.value)
            }
          />
          <input
            className="text-input"
            placeholder="Quantity"
            value={
              ingredient.quantity === null || typeof ingredient.quantity === "undefined"
                ? ""
                : ingredient.quantity
            }
            onChange={(event) =>
              updateIngredient(index, "quantity", event.target.value)
            }
          />
          <input
            className="text-input"
            placeholder="Unit"
            value={ingredient.unit || ""}
            onChange={(event) =>
              updateIngredient(index, "unit", event.target.value)
            }
          />
          <input
            className="text-input"
            placeholder="Ingredient"
            value={ingredient.ingredient || ""}
            onChange={(event) =>
              updateIngredient(index, "ingredient", event.target.value)
            }
          />
          <button
            className="danger-button"
            type="button"
            onClick={() => removeIngredient(index)}
          >
            Remove
          </button>
        </div>
      ))}
      <button className="secondary-button" type="button" onClick={addIngredient}>
        Add ingredient
      </button>
      <label>Steps</label>
      {(draft.steps || []).map((step, index) => (
        <div
          key={index}
          style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}
        >
          <textarea
            className="textarea"
            value={step}
            onChange={(event) =>
              onChange((prev) => {
                const steps = [...(prev.steps || [])];
                steps[index] = event.target.value;
                return { ...prev, steps };
              })
            }
          />
          <button
            className="danger-button"
            type="button"
            onClick={() => removeStep(index)}
          >
            Remove
          </button>
        </div>
      ))}
      <button className="secondary-button" type="button" onClick={addStep}>
        Add step
      </button>
      <label>Notes</label>
      <textarea
        className="textarea"
        value={draft.notes || ""}
        onChange={(event) => updateField("notes", event.target.value)}
      />
      <label>Nutrition facts (one per line)</label>
      <textarea
        className="textarea"
        value={nutritionDraftText}
        onChange={(event) => {
          const value = event.target.value;
          setNutritionDraftText(value);
          onChange((prev) => ({
            ...prev,
            nutrition: parseNutritionLines(value, prev.nutrition || []),
          }));
        }}
        placeholder="Calories: 320 kcal&#10;Protein: 18 g&#10;Fat: 12 g"
      />
      <div className="export-actions">
        <button className="primary-button" type="button" onClick={submit}>
          {primaryLabel}
        </button>
      </div>
      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}

function RecipeDetailModal({ recipe, onClose, onEditFull, onUpdateSections }) {
  const [editing, setEditing] = useState(false);
  const [ingredientsDraft, setIngredientsDraft] = useState("");
  const [stepsDraft, setStepsDraft] = useState("");
  const [localError, setLocalError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!recipe) return;
    setIngredientsDraft(formatIngredientDraft(recipe.ingredients));
    setStepsDraft(formatStepDraft(recipe.steps));
    setEditing(false);
    setLocalError(null);
    setSaving(false);
  }, [recipe]);

  useEffect(() => {
    if (editing) {
      setIngredientsDraft(formatIngredientDraft(recipe?.ingredients));
      setStepsDraft(formatStepDraft(recipe?.steps));
    }
  }, [editing, recipe]);

  if (!recipe) return null;

  const toggleEditing = () => {
    setEditing((prev) => !prev);
    setLocalError(null);
  };

  const handleInlineSave = async () => {
    const ingredientLines = ingredientsDraft
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const stepLines = stepsDraft
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (ingredientLines.length === 0) {
      setLocalError("Add at least one ingredient before saving.");
      return;
    }
    if (stepLines.length === 0) {
      setLocalError("Add at least one cooking step before saving.");
      return;
    }

    const updatedIngredients = ingredientLines.map((line, index) => ({
      id:
        recipe.ingredients?.[index]?.id ||
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `ing-${Date.now()}-${index}`),
      original: line,
    }));

    try {
      setSaving(true);
      setLocalError(null);
      await onUpdateSections(recipe.id, {
        ingredients: updatedIngredients,
        steps: stepLines,
      });
      setEditing(false);
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={recipe.name || "Recipe"} onClose={onClose}>
      <div className="export-actions">
        <button className="secondary-button" onClick={toggleEditing}>
          {editing ? "Cancel quick edits" : "Quick edit ingredients & steps"}
        </button>
        <button className="secondary-button" onClick={onEditFull}>
          Open full editor
        </button>
      </div>

      <div className="recipe-detail">
        <div className="section-box">
          <h3>Overview</h3>
          {recipe.url && (
            <p>
              <strong>Source:</strong>{" "}
              <a href={recipe.url} target="_blank" rel="noreferrer">
                {recipe.url}
              </a>
            </p>
          )}
          {recipe.categories?.length > 0 && (
            <p>
              <strong>Categories:</strong> {recipe.categories.join(", ")}
            </p>
          )}
          {recipe.notes && (
            <p>
              <strong>Notes:</strong> {recipe.notes}
            </p>
          )}
        </div>
        <div className="section-box">
          <h3>Ingredients</h3>
          {editing ? (
            <textarea
              className="multi-line-input"
              value={ingredientsDraft}
              onChange={(event) => setIngredientsDraft(event.target.value)}
              placeholder="One ingredient per line"
            />
          ) : (
            <ul>
              {(recipe.ingredients || []).map((item) => (
                <li key={item.id || item.original}>
                  {formatIngredientLine(item)}
                  {item.notes ? ` (${item.notes})` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="section-box">
          <h3>Steps</h3>
          {editing ? (
            <textarea
              className="multi-line-input"
              value={stepsDraft}
              onChange={(event) => setStepsDraft(event.target.value)}
              placeholder="One cooking step per line"
            />
          ) : (
            <ol>
              {(recipe.steps || []).map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
          )}
        </div>
        {recipe.nutrition?.length > 0 && (
          <div className="section-box">
            <h3>Nutrition</h3>
            <ul>
              {recipe.nutrition.map((item) => (
                <li key={item.id || item.label || item.value}>
                  {item.label ? <strong>{item.label}: </strong> : null}
                  {item.value}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {editing && (
        <div className="export-actions">
          <button
            className="primary-button"
            onClick={handleInlineSave}
            disabled={saving}
          >
            Save ingredient & step changes
          </button>
        </div>
      )}
      {localError && <div className="error-banner">{localError}</div>}
    </ModalShell>
  );
}

function useShoppingList(token, recipes) {
  const [list, setList] = useState([]);
  useEffect(() => {
    let cancelled = false;
    if (recipes.length === 0) {
      setList([]);
      return;
    }
    const load = async () => {
      try {
        const recipeIds = recipes
          .map((recipe) => recipe.id)
          .filter((id) => typeof id === "string" && id.length > 0);
        const payload =
          recipeIds.length > 0
            ? await api.previewShoppingList(token, recipeIds)
            : await api.previewShoppingList(token, recipes);
        if (!cancelled) {
          setList(payload.shoppingList || []);
        }
      } catch (err) {
        console.error(err);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [token, recipes]);

  return list;
}

function MealPlannerModal({ recipes, shoppingList, onClose }) {
  const [exportStatus, setExportStatus] = useState(null);
  const [apiEndpoint, setApiEndpoint] = useState("");
  const listRef = useCallback((node) => {
    if (node) {
      node.setAttribute("id", "shopping-list-print-area");
    }
  }, []);

  const exportJson = () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      recipes: recipes.map((recipe) => ({
        id: recipe.id,
        name: recipe.name,
      })),
      items: shoppingList,
    };
    downloadBlob(
      "shopping-list.json",
      JSON.stringify(payload, null, 2),
      "application/json"
    );
    setExportStatus("Downloaded JSON file.");
  };

  const exportCsv = () => {
    const headers = ["ingredient", "quantity", "unit", "notes"];
    const lines = shoppingList.map((item) =>
      [
        item.ingredient?.replace(/"/g, '""') || "",
        item.quantity ?? "",
        item.unit ?? "",
        item.notes?.replace(/"/g, '""') || "",
      ]
        .map((field) => `"${field}"`)
        .join(",")
    );
    const csv = [headers.join(","), ...lines].join("\n");
    downloadBlob("shopping-list.csv", csv, "text/csv");
    setExportStatus("Downloaded CSV file.");
  };

  const exportText = () => {
    const lines = shoppingList.map((item) => {
      const base = formatIngredientLine(item);
      return `• ${base}${item.notes ? ` — ${item.notes}` : ""}`;
    });
    downloadBlob("shopping-list.txt", lines.join("\n"), "text/plain");
    setExportStatus("Downloaded text checklist.");
  };

  const exportImage = async () => {
    const node = document.getElementById("shopping-list-print-area");
    if (!node) return;
    try {
      const canvas = await html2canvas(node);
      const dataUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = "shopping-list.png";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setExportStatus("Saved shopping list as image.");
    } catch (err) {
      console.error(err);
      setExportStatus("Failed to create image.");
    }
  };

  const sendToApi = async () => {
    if (!apiEndpoint.trim()) {
      setExportStatus("Provide an API endpoint URL first.");
      return;
    }
    try {
      const payload = {
        generatedAt: new Date().toISOString(),
        recipes: recipes.map((recipe) => ({
          id: recipe.id,
          name: recipe.name,
        })),
        items: shoppingList,
      };
      const response = await fetch(apiEndpoint.trim(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error("API responded with an error.");
      }
      setExportStatus("Shopping list sent to API endpoint.");
    } catch (err) {
      console.error(err);
      setExportStatus(err.message);
    }
  };

  return (
    <ModalShell
      title={`Meal Planner (${recipes.length} recipe${
        recipes.length === 1 ? "" : "s"
      })`}
      onClose={onClose}
    >
      {recipes.length === 0 ? (
        <p>Select recipes from the dashboard to build a meal plan.</p>
      ) : (
        <>
          <div className="section-box">
            <h3>Included Recipes</h3>
            <ul>
              {recipes.map((recipe) => (
                <li key={recipe.id}>{recipe.name}</li>
              ))}
            </ul>
          </div>
          <div className="section-box shopping-list" ref={listRef}>
            <h3>Shopping List</h3>
            {shoppingList.length === 0 ? (
              <p>No ingredients found.</p>
            ) : (
              shoppingList.map((item, index) => (
                <div className="shopping-item" key={`${item.ingredient}-${index}`}>
                  <span>{item.ingredient}</span>
                  <small>
                    {item.quantity !== null && typeof item.quantity !== "undefined"
                      ? `${item.quantity}${item.unit ? ` ${item.unit}` : ""}`
                      : item.unit || ""}
                    {item.notes ? ` • ${item.notes}` : ""}
                  </small>
                </div>
              ))
            )}
          </div>
          <div className="section-box">
            <h3>Export options</h3>
            <div className="export-actions">
              <button className="primary-button" onClick={exportJson}>
                Download JSON
              </button>
              <button className="secondary-button" onClick={exportCsv}>
                Download CSV
              </button>
              <button className="secondary-button" onClick={exportText}>
                Download Text
              </button>
              <button className="secondary-button" onClick={exportImage}>
                Save as Image
              </button>
            </div>
            <div style={{ marginTop: "1rem" }}>
              <label>POST shopping list to API</label>
              <input
                className="text-input"
                placeholder="https://your-service.example/api"
                value={apiEndpoint}
                onChange={(event) => setApiEndpoint(event.target.value)}
              />
              <button className="secondary-button" onClick={sendToApi}>
                Send list
              </button>
            </div>
            <button
              className="secondary-button"
              style={{ marginTop: "0.5rem" }}
              onClick={async () => {
                try {
                  const response = await api.exportShoppingList(shoppingList);
                  setExportStatus(
                    `Saved locally as ${response.filename}. Check the exports folder.`
                  );
                } catch (err) {
                  setExportStatus(err.message);
                }
              }}
            >
              Archive to local JSON
            </button>
          </div>
        </>
      )}
      {exportStatus && <div className="badge">{exportStatus}</div>}
    </ModalShell>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
