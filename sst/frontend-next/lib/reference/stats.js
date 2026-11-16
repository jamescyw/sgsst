import { calcAge, calcYears } from "./helpers";

// Funciones auxiliares para rangos
function getAgeRange(age) {
  if (age === null || age === undefined || Number.isNaN(age)) return "Sin dato";
  if (age < 25) return "18-24";
  if (age < 35) return "25-34";
  if (age < 45) return "35-44";
  if (age < 55) return "45-54";
  return "55+";
}

function getAntiguedadRange(years) {
  if (years === null || years === undefined || Number.isNaN(years)) return "Sin dato";
  if (years < 1) return "<1 año";
  if (years < 3) return "1-2 años";
  if (years < 5) return "3-4 años";
  if (years < 8) return "5-7 años";
  if (years < 12) return "8-11 años";
  return "12+ años";
}

export function computeStats(reportes) {
  const attrs = reportes.map(r => r.attributes);

  // Función genérica para agrupar atributos directos del reporte
  function groupBy(fn) {
    const map = {};
    attrs.forEach(a => { 
      const k = fn(a) || "Desconocido"; 
      map[k] = (map[k] || 0) + 1; 
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => ({ label, count }));
  }

  // --- MÉTRICAS DE SEGUIMIENTOS (Gestiones) ---
  const imcData = (() => {
    const map = {};
    attrs.forEach(a => {
      // Tomamos el último seguimiento que tenga registro de peso y talla
      const gestiones = a.sst_actions_webs?.data || [];
      const lastG = [...gestiones].reverse().find(g => g.attributes.peso_kg && g.attributes.talla_m);
      if (!lastG) return;
      
      const peso = parseFloat(lastG.attributes.peso_kg);
      const talla = parseFloat(lastG.attributes.talla_m);
      if (isNaN(peso) || isNaN(talla) || talla === 0) return;

      const imc = peso / (talla * talla);
      const category = imc < 18.5 ? "Bajo (<18.5)" : imc < 25 ? "Normal (18.5-24.9)" : imc < 30 ? "Sobrepeso (25-29.9)" : "Obeso (≥30)";
      map[category] = (map[category] || 0) + 1;
    });
    return Object.entries(map).map(([label, count]) => ({ label, count }));
  })();

  const diagnosticoData = (() => {
    const map = {};
    attrs.forEach(a => {
      (a.sst_actions_webs?.data || []).forEach(g => {
        const k = g.attributes.codigo_cie || (g.attributes.diagnostico_cie ? g.attributes.diagnostico_cie.slice(0, 30) : null);
        if (k) map[k] = (map[k] || 0) + 1;
      });
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => ({ label, count }));
  })();

  const accionData = (() => {
    const map = {};
    attrs.forEach(a => {
      (a.sst_actions_webs?.data || []).forEach(g => {
        const k = g.attributes.accion_realizada?.replace(/_/g, " ") || "Sin acción";
        map[k] = (map[k] || 0) + 1;
      });
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
  })();

  const sistemaData = (() => {
    const map = {};
    attrs.forEach(a => {
      (a.sst_actions_webs?.data || []).forEach(g => {
        const sistema = g.attributes.sistema_afectado;
        if (sistema) {
          const key = sistema.trim().toLocaleLowerCase();
          const label = key.toLocaleUpperCase();
          map[key] = { label, count: (map[key]?.count || 0) + 1 };
        }
      });
    });
    return Object.values(map).sort((a, b) => b.count - a.count);
  })();

  const segmentoData = (() => {
    const map = {};
    attrs.forEach(a => {
      (a.sst_actions_webs?.data || []).forEach(g => {
        let segs = g.attributes.datos_adicionales?.segmento_corporal;
        if (segs) {
          if (!Array.isArray(segs)) segs = [segs];
          segs.forEach(s => {
            if(s) map[s] = (map[s] || 0) + 1;
          });
        }
      });
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
  })();

  // --- MÉTRICAS DEL COLABORADOR (Pobladas desde el arreglo) ---
  const cargoData = (() => {
    const map = {};
    attrs.forEach(a => {
      const k = a.colaborador?.[0]?.cargo?.trim() || "Sin cargo";
      map[k] = (map[k] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => ({ label, count }));
  })();

  const edadData = (() => {
    const map = {};
    attrs.forEach(a => {
      const nacimiento = a.colaborador?.[0]?.nacimiento;
      const age = nacimiento ? calcAge(nacimiento) : null;
      const k = getAgeRange(age);
      map[k] = (map[k] || 0) + 1;
    });
    // Se ordena alfabéticamente para que los rangos del LineChart tengan sentido visual (18-24, 25-34...)
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).map(([label, count]) => ({ label, count }));
  })();

  const antiguedadData = (() => {
    const map = {};
    attrs.forEach(a => {
      const ingreso = a.colaborador?.[0]?.antiguedad;
      const years = ingreso ? calcYears(ingreso) : null;
      const k = getAntiguedadRange(years);
      map[k] = (map[k] || 0) + 1;
    });
    // Se ordena alfabéticamente para que los rangos del LineChart tengan sentido (<1, 1-2, 3-4...)
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).map(([label, count]) => ({ label, count }));
  })();

  const areaData = (() => {
    const map = {};
    attrs.forEach(a => {
      const colab = a.colaborador?.[0] || {};
      const k = colab.area || colab.departamento || "Sin área";
      map[k] = (map[k] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => ({ label, count }));
  })();

  // Construcción del objeto final exportado
  return {
    estadoCasos: groupBy(a => a.estado),
    entidad: groupBy(a => a.tipo_entidad),
    genero: groupBy(a => a.colaborador?.[0]?.genero),
    categoria: groupBy(a => a.categoria?.replace(/_/g, " ")),
    imc: imcData,
    accion: accionData,
    sistema: sistemaData,
    segmento: segmentoData,
    diagnostico: diagnosticoData,
    cargo: cargoData,
    edadRango: edadData,
    antiguedadRango: antiguedadData,
    area: areaData,
  };
}