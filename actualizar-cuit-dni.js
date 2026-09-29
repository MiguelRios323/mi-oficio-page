const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "src", "app", "page.tsx");

if (!fs.existsSync(file)) {
  console.error("❌ No se encontró src/app/page.tsx");
  process.exit(1);
}

let code = fs.readFileSync(file, "utf8");

// ============================================================
// 1. BACKUP AUTOMÁTICO
// ============================================================

const backup = file.replace(
  /\.tsx$/,
  `.backup-${Date.now()}.tsx`
);

fs.writeFileSync(backup, code, "utf8");

console.log("✅ Backup creado:");
console.log(backup);

// ============================================================
// 2. AGREGAR ESTADOS
// ============================================================

const stateBlock = `

  // ==========================================================
  // CUIT / DNI — PERFIL PROFESIONAL
  // ==========================================================

  const [cuitDni, setCuitDni] = useState("");
  const [guardandoCuitDni, setGuardandoCuitDni] = useState(false);
  const [cuitDniGuardado, setCuitDniGuardado] = useState(false);

  useEffect(() => {
    try {
      const documentoGuardado = localStorage.getItem(
        "mioficio_cuit_dni"
      );

      if (documentoGuardado) {
        setCuitDni(documentoGuardado);
      }
    } catch (error) {
      console.error(
        "No se pudo cargar el CUIT / DNI:",
        error
      );
    }
  }, []);

  const guardarCuitDni = async () => {
    const documento = cuitDni.trim();

    if (!documento) {
      alert(
        "Completá tu CUIT / DNI antes de guardar."
      );
      return;
    }

    setGuardandoCuitDni(true);
    setCuitDniGuardado(false);

    try {
      localStorage.setItem(
        "mioficio_cuit_dni",
        documento
      );

      setCuitDni(documento);
      setCuitDniGuardado(true);

      setTimeout(() => {
        setCuitDniGuardado(false);
      }, 3000);
    } catch (error) {
      console.error(
        "Error guardando CUIT / DNI:",
        error
      );

      alert(
        "No se pudo guardar el CUIT / DNI."
      );
    } finally {
      setGuardandoCuitDni(false);
    }
  };

`;


// ============================================================
// 3. BUSCAR EL PRIMER useState DEL COMPONENTE
// ============================================================

if (!code.includes("mioficio_cuit_dni")) {

  const useStateRegex =
    /(\n\s*const\s+\[[^\]]+\]\s*=\s*useState[\s\S]*?;)/;

  const match = code.match(useStateRegex);

  if (match) {

    const position =
      match.index + match[0].length;

    code =
      code.slice(0, position) +
      stateBlock +
      code.slice(position);

    console.log(
      "✅ Sistema de CUIT / DNI agregado."
    );

  } else {

    console.error(
      "❌ No pude encontrar un useState para insertar el sistema."
    );

    console.log(
      "El backup permanece intacto."
    );

    process.exit(1);
  }

} else {

  console.log(
    "ℹ️ El sistema de CUIT / DNI ya existe. No se duplicó."
  );
}


// ============================================================
// 4. CREAR BLOQUE VISUAL PARA PERFIL
// ============================================================

const profileBlock = `

{/* =========================================================
    CUIT / DNI — PERFIL PROFESIONAL
========================================================= */}

<div className="rounded-2xl border border-gray-200 bg-white p-4">

  <div className="mb-3">

    <h3 className="text-sm font-semibold text-gray-900">
      CUIT / DNI
    </h3>

    <p className="mt-1 text-xs text-gray-500">
      Este dato será utilizado para activar Premium.
    </p>

  </div>

  <input
    type="text"
    value={cuitDni}
    onChange={(e) => setCuitDni(e.target.value)}
    placeholder="Ingresá tu CUIT o DNI"
    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-black"
  />

  <div className="mt-3 flex items-center gap-3">

    <button
      type="button"
      onClick={guardarCuitDni}
      disabled={guardandoCuitDni}
      className="rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {guardandoCuitDni
        ? "Guardando..."
        : cuitDniGuardado
        ? "✓ Guardado"
        : "Guardar datos"}
    </button>

    {cuitDniGuardado && (
      <span className="text-xs text-green-600">
        Datos guardados correctamente.
      </span>
    )}

  </div>

</div>

`;

// ============================================================
// 5. INSERTAR EN PERFIL
// ============================================================

// Buscamos textos habituales de la sección Perfil.

const profileMarkers = [
  "Perfil profesional",
  "Perfil Profesional",
  "perfil profesional",
  "Mi perfil",
];

let profileInserted = false;

for (const marker of profileMarkers) {

  const index = code.indexOf(marker);

  if (index !== -1) {

    // Buscamos el siguiente cierre razonable
    // sin modificar la estructura existente.
    const after = code.slice(index);

    const divIndex = after.indexOf("</div>");

    if (divIndex !== -1) {

      const absolute =
        index + divIndex + "</div>".length;

      code =
        code.slice(0, absolute) +
        profileBlock +
        code.slice(absolute);

      profileInserted = true;

      console.log(
        "✅ Bloque CUIT / DNI agregado al Perfil."
      );

      break;
    }
  }
}

if (!profileInserted) {

  console.log(
    "⚠️ No encontré automáticamente el contenedor exacto de Perfil."
  );

  console.log(
    "El sistema de guardado sí fue agregado."
  );
}


// ============================================================
// 6. MODIFICAR PAGAR PREMIUM
// ============================================================

if (!code.includes("const documentoPremium")) {

  const fetchIndex =
    code.indexOf('fetch("/api/dlocal/create"');

  if (fetchIndex !== -1) {

    const premiumValidation = `

      const documentoPremium =
        cuitDni.trim() ||
        localStorage
          .getItem("mioficio_cuit_dni")
          ?.trim() ||
        "";

      if (!documentoPremium) {
        throw new Error(
          "Antes de activar Premium, completá tu CUIT / DNI en Perfil y guardá los datos."
        );
      }

`;

    // Buscar el inicio de la función o bloque anterior
    // al fetch y colocar la validación antes.
    code =
      code.slice(0, fetchIndex) +
      premiumValidation +
      code.slice(fetchIndex);

    console.log(
      "✅ Validación automática de CUIT / DNI agregada al pago Premium."
    );

  } else {

    console.log(
      "⚠️ No encontré /api/dlocal/create."
    );

    console.log(
      "La integración dLocal no fue modificada."
    );
  }
}


// ============================================================
// 7. AGREGAR CUIT/DNI AL BODY DE DLOCAL
// ============================================================

if (
  code.includes("documentoPremium") &&
  !code.includes("cuitDni: documentoPremium")
) {

  const bodyIndex =
    code.indexOf("body: JSON.stringify({");

  if (bodyIndex !== -1) {

    const start =
      bodyIndex +
      "body: JSON.stringify({".length;

    code =
      code.slice(0, start) +
      `

        cuitDni: documentoPremium,` +
      code.slice(start);

    console.log(
      "✅ CUIT / DNI agregado al envío hacia dLocal."
    );

  } else {

    console.log(
      "⚠️ No encontré body: JSON.stringify({)."
    );
  }
}


// ============================================================
// 8. GUARDAR PAGE.TSX
// ============================================================

fs.writeFileSync(file, code, "utf8");

console.log("");
console.log("==============================================");
console.log("   MIOficio — ACTUALIZACIÓN COMPLETADA");
console.log("==============================================");
console.log("");
console.log("✅ CUIT / DNI");
console.log("✅ Guardar datos");
console.log("✅ Recuperación automática");
console.log("✅ Validación antes de Premium");
console.log("✅ Envío del CUIT/DNI a dLocal");
console.log("✅ Backup automático");
console.log("");
console.log("Ahora ejecutá:");
console.log("npm run dev");
console.log("");
console.log("Y abrí Perfil profesional.");
console.log("==============================================");