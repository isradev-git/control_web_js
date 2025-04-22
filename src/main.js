// Configuración
const CONFIG = {
  checkSSL: true,
  checkLatency: true,
  maxConcurrentChecks: 5,
  emailRecipient: "clientes@entreredes.es",
  csvPresets: {
      "Sitios principales": "data/websites.csv",
      // "Redes sociales": "data/redes-sociales.csv"
  }
};

// Estado
const state = {
  sites: [],
  results: [],
  isAnalyzing: false
};

// Elementos del DOM
const DOM = {
  csvSelector: document.getElementById("csvSelector"),
  analyzeBtn: document.getElementById("analyzeBtn"),
  sendEmailBtn: document.getElementById("sendEmailBtn"),
  progressBar: document.getElementById("progressBar"),
  resultsBody: document.getElementById("resultsBody"),
  notification: document.getElementById("notification"),
  notificationMessage: document.getElementById("notificationMessage"),
  totalSites: document.getElementById("totalSites"),
  upSites: document.getElementById("upSites"),
  downSites: document.getElementById("downSites"),
  avgLatency: document.getElementById("avgLatency")
};

// Inicialización
function init() {
  setupEventListeners();
  populateCsvSelector();
}

// Configurar eventos
function setupEventListeners() {
  DOM.analyzeBtn.addEventListener("click", startAnalysis);
  DOM.sendEmailBtn.addEventListener("click", sendEmailReport);
}

// Llenar selector de CSVs
function populateCsvSelector() {
  DOM.csvSelector.innerHTML = Object.entries(CONFIG.csvPresets)
      .map(([name, path]) => `<option value="${path}">${name}</option>`)
      .join("");
}

// Mostrar notificación
function showNotification(message, type = "info") {
  const colors = {
      info: "bg-indigo-500",
      success: "bg-green-500",
      warning: "bg-yellow-500",
      danger: "bg-red-500"
  };
  
  DOM.notification.className = `${colors[type]} fixed bottom-4 right-4 p-4 rounded-md shadow-lg text-white animate-fade-in`;
  DOM.notificationMessage.textContent = message;
  DOM.notification.classList.remove("hidden");
  
  setTimeout(() => {
      DOM.notification.classList.add("hidden");
  }, 3000);
}

// Cargar CSV
async function loadCSV(path) {
  try {
      const response = await fetch(path);
      if (!response.ok) throw new Error("Error cargando CSV");
      const text = await response.text();
      const validatedData = validateCSV(text); // Validar el CSV
      return validatedData;
  } catch (error) {
      showNotification("Error cargando el CSV", "danger");
      return [];
  }
}

// Validar CSV
function validateCSV(data) {
  const lines = data.split("\n").map(line => line.trim());
  const invalidLines = lines.filter(line => line && !line.startsWith("#") && !line.startsWith("http://") && !line.startsWith("https://"));
  if (invalidLines.length > 0) {
      console.warn("Líneas inválidas encontradas en el CSV:", invalidLines);
      showNotification(`El archivo CSV contiene líneas inválidas. Se omitirán ${invalidLines.length} líneas.`, "warning");
  }
  return lines.filter(line => line && !line.startsWith("#") && (line.startsWith("http://") || line.startsWith("https://")));
}

// Iniciar análisis
async function startAnalysis() {
  if (state.isAnalyzing) return;
  
  try {
      state.isAnalyzing = true;
      DOM.analyzeBtn.disabled = true;
      DOM.analyzeBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Analizando...';
      
      // Cargar sitios
      const csvPath = DOM.csvSelector.value;
      state.sites = await loadCSV(csvPath);
      
      if (state.sites.length === 0) {
          showNotification("No hay sitios para analizar", "warning");
          return;
      }
      
      // Resetear estado
      state.results = [];
      DOM.resultsBody.innerHTML = "";
      updateStats();
      showNotification(`Analizando ${state.sites.length} sitios...`, "info");
      
      // Procesar en lotes
      for (let i = 0; i < state.sites.length; i += CONFIG.maxConcurrentChecks) {
          const batch = state.sites.slice(i, i + CONFIG.maxConcurrentChecks);
          await processBatch(batch);
      }
      
      showNotification("Análisis completado", "success");
      DOM.sendEmailBtn.disabled = false;
      
  } catch (error) {
      console.error("Error:", error);
      showNotification("Error durante el análisis", "danger");
  } finally {
      state.isAnalyzing = false;
      DOM.analyzeBtn.disabled = false;
      DOM.analyzeBtn.innerHTML = '<i class="fas fa-play mr-2"></i>Iniciar análisis';
  }
}

// Procesar lote de sitios
async function processBatch(batch) {
  const promises = batch.map(url => checkWebsite(url));
  const results = await Promise.all(promises);
  
  state.results.push(...results);
  updateProgress();
  updateResultsTable(results);
  updateStats();
}

// Verificar un sitio web
async function checkWebsite(url) {
  const startTime = Date.now();
  let status = "DOWN";
  let latency = 0;
  let sslValid = url.startsWith("https://");

  // Configurar un timeout de 5 segundos con AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      method: "GET", // Cambiamos a GET para mayor compatibilidad
      mode: "cors", // Cambiamos a cors para obtener más información
      cache: "no-store",
      signal: controller.signal,
      redirect: "follow" // Seguir redirecciones automáticamente
    });

    if (response.ok) {
      status = "UP";
      latency = Date.now() - startTime;
    } else {
      console.warn(`Sitio ${url} no está disponible: ${response.status} ${response.statusText}`);
      status = "DOWN";
    }
  } catch (error) {
    if (error.name === "AbortError") {
      console.warn(`Timeout al verificar ${url}: La solicitud excedió los 5 segundos`);
    } else if (error.message.includes("Failed to fetch")) {
      console.warn(`Error de CORS o red al verificar ${url}: ${error.message}`);
      // Intento alternativo: Verificar con una solicitud HEAD y no-cors como respaldo
      try {
        const fallbackResponse = await fetch(url, {
          method: "HEAD",
          mode: "no-cors",
          cache: "no-store"
        });
        status = "UP"; // Si no hay error, asumimos que el sitio está disponible
        latency = Date.now() - startTime;
      } catch (fallbackError) {
        console.warn(`Fallback falló para ${url}: ${fallbackError.message}`);
        status = "DOWN";
      }
    } else {
      console.warn(`Error al verificar ${url}: ${error.message}`);
      status = "DOWN";
    }
  } finally {
    clearTimeout(timeoutId);
  }

  return {
    url,
    status,
    latency,
    sslValid,
    lastChecked: new Date().toLocaleTimeString()
  };
}

// Actualizar barra de progreso
function updateProgress() {
  const percent = (state.results.length / state.sites.length) * 100;
  DOM.progressBar.style.width = `${percent}%`;
}

// Actualizar tabla de resultados
function updateResultsTable(results) {
  results.forEach(result => {
      const row = document.createElement("tr");
      row.className = "hover:bg-gray-50";
      
      // URL
      const urlCell = document.createElement("td");
      urlCell.className = "px-6 py-4 whitespace-nowrap";
      const urlLink = document.createElement("a");
      urlLink.href = result.url;
      urlLink.textContent = result.url;
      urlLink.className = "text-indigo-600 hover:underline";
      urlLink.target = "_blank";
      urlCell.appendChild(urlLink);
      
      // Estado
      const statusCell = document.createElement("td");
      statusCell.className = "px-6 py-4 whitespace-nowrap";
      const statusBadge = document.createElement("span");
      statusBadge.className = `px-2 py-1 rounded-full text-xs font-medium ${
          result.status === "UP" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
      }`;
      statusBadge.textContent = result.status === "UP" ? "ACTIVO" : "INACTIVO";
      statusCell.appendChild(statusBadge);
      
      // Latencia
      const latencyCell = document.createElement("td");
      latencyCell.className = "px-6 py-4 whitespace-nowrap";
      if (CONFIG.checkLatency && result.latency > 0) {
          const latencySpan = document.createElement("span");
          latencySpan.className = "font-mono " + (
              result.latency < 300 ? "text-green-600" : 
              result.latency < 1000 ? "text-yellow-600" : "text-red-600"
          );
          latencySpan.textContent = `${result.latency}ms`;
          latencyCell.appendChild(latencySpan);
      } else {
          latencyCell.textContent = "N/A";
      }
      
      // SSL
      const sslCell = document.createElement("td");
      sslCell.className = "px-6 py-4 whitespace-nowrap";
      if (CONFIG.checkSSL) {
          const sslBadge = document.createElement("span");
          sslBadge.className = `px-2 py-1 rounded-full text-xs font-medium ${
              result.sslValid ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
          }`;
          sslBadge.textContent = result.sslValid ? "VÁLIDO" : "INVÁLIDO";
          sslCell.appendChild(sslBadge);
      } else {
          sslCell.textContent = "No verificado";
      }
      
      // Última verificación
      const lastCheckedCell = document.createElement("td");
      lastCheckedCell.className = "px-6 py-4 whitespace-nowrap text-gray-500";
      lastCheckedCell.textContent = result.lastChecked;
      
      // Añadir celdas a la fila
      row.append(urlCell, statusCell, latencyCell, sslCell, lastCheckedCell);
      DOM.resultsBody.appendChild(row);
  });
}

// Actualizar estadísticas
function updateStats() {
  DOM.totalSites.textContent = state.results.length;
  
  const upCount = state.results.filter(r => r.status === "UP").length;
  DOM.upSites.textContent = upCount;
  DOM.downSites.textContent = state.results.length - upCount;
  
  const avgLatency = state.results.length > 0 
      ? Math.round(state.results.reduce((sum, r) => sum + (r.latency || 0), 0) / state.results.length)
      : 0;
  DOM.avgLatency.textContent = avgLatency;
}

// Enviar informe por email (simulado)
// await emailjs.send("service_02jr8xm", "template_jy8pqw9", templateParams);
async function sendEmailReport() {
  if (state.results.length === 0) {
      showNotification("No hay resultados para enviar", "warning");
      return;
  }

  try {
      DOM.sendEmailBtn.disabled = true;
      DOM.sendEmailBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Enviando...';

      // Inicializar EmailJS con tu API key
      emailjs.init("cSUkwjYlO7vyyGUPK");

      // Preparar el contenido del correo
      const templateParams = {
          to_email: CONFIG.emailRecipient,
          subject: "Informe de Monitoreo Web",
          message: generateEmailContent(state.results)
      };

      // Enviar el correo usando un servicio y plantilla de EmailJS
      await emailjs.send("service_02jr8xm", "template_jy8pqw9", templateParams);

      showNotification(`Informe enviado a ${CONFIG.emailRecipient}`, "success");
  } catch (error) {
      console.error("Error enviando el correo:", error);
      showNotification("Error al enviar el informe", "danger");
  } finally {
      DOM.sendEmailBtn.disabled = false;
      DOM.sendEmailBtn.innerHTML = '<i class="fas fa-envelope mr-2"></i>Enviar informe';
  }
}

// Generar el contenido del correo
function generateEmailContent(results) {
  let content = "<h3>Resultados del Análisis:</h3><ul>";
  results.forEach(result => {
      content += `<li><strong>${result.url}</strong>:<br>`;
      content += `- Estado: ${result.status}<br>`;
      content += `- Latencia: ${result.latency || "N/A"}ms<br>`;
      content += `- SSL: ${result.sslValid ? "VÁLIDO" : "INVÁLIDO"}<br>`;
      content += `- Última verificación: ${result.lastChecked}<br></li>`;
  });
  content += "</ul>";
  return content;
}

// Iniciar la aplicación
document.addEventListener("DOMContentLoaded", init);