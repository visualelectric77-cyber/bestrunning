#!/usr/bin/env python3
"""BestRunning · v2.1 ARCHIVADA del Atajo «BestRunning FC» (la que recorre cada lectura con un Repetir).
La actual es tools/watch/build-shortcut.py (v2.2). Esta escribe en tools/watch/out/v21/ y NO firma salvo que se pase --sign.


Contrato (js/integrations/watch-hr.js):
  entrada  texto JSON {"v":1,"id":"ses_…","start":"2026-10-18T11:33:00+02:00","end":"…"}  (Entrada del atajo)
  salida   portapapeles con el JSON {"v":1,"id","avg","max","min","csv","mode"}; csv = líneas "<ISO 8601>,<valor>"
           "mode" = "window" (búsqueda exacta) o "wide" (búsqueda amplia); la app no lo necesita y lo ignora.

v2 (tras el fallo de la v1 el 18-10-2026, «no hay pulso del Apple Watch en ese horario»):
  1. Búsqueda exacta: Frecuencia cardiaca con «Fecha de inicio está entre start y end». Las variables van a la vez
     en Values.Date / AnotherDate (forma moderna, atajo de ejemplo de Apple) y en VariableOverrides.dateValue /
     anotherDateValue (forma antigua exportada); cada fecha es el PRIMER elemento de «Obtener fechas».
  2. Si no da nada: búsqueda amplia con filtro CONSTANTE «está en los últimos 3 días» (sin variables), las más
     recientes primero, con límite. La app se queda solo con las de la sesión.
  3. Si tampoco: busca la lectura de pulso más reciente que haya en Salud (sin filtro de fecha, límite 1).
       · hay alguna → «no hay pulso de este entreno; la más reciente es de …» (no es el permiso);
       · no hay ninguna → es el PERMISO de Salud: dice dónde activarlo. En los dos casos no copia nada.
  Sin entrada (ejecutado a mano desde Atajos): autodiagnóstico en una alerta (lecturas de hoy, de los últimos
  3 días y la más reciente, y si el permiso está bien). No copia nada.
  Todas las filas de filtro llevan Bounded true y la acción WFHKSampleFilteringFillMissing false, como el atajo
  de pulso exportado de un iPhone real (suliveevil/My-Siri-Shortcuts, «Heart Rate Data»).

Solo usa la biblioteca estándar (plistlib). Uso:
  python3 tools/watch/build-shortcut.py            # genera, valida y firma (shortcuts sign --mode anyone)
  python3 tools/watch/build-shortcut.py --no-sign  # genera y valida, sin firmar
  python3 tools/watch/build-shortcut-v1.py         # la v1 archivada, en tools/watch/out/v1/ (sin firmar)

Salidas en tools/watch/out/:
  BestRunning-FC.unsigned.shortcut   plist binario sin firmar (lo que se firma)
  BestRunning-FC.xml.plist           volcado XML para revisar (plutil -convert xml1 de una copia)
  BestRunning-FC.json                volcado JSON (mismo contenido, más fácil de leer y de testear)
  BestRunning-FC.shortcut            firmado (nombre pedido por el proyecto)
  BestRunning FC.shortcut            la misma firma con el nombre exacto del Atajo: ESTE es el que se importa.

Las claves y valores salen de atajos exportados reales, de referencias públicas y de las cadenas de
WorkflowKit/ActionKit de macOS 26 (ver tools/watch/README.md, «Fuentes»).
"""
import json
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / 'out' / 'v21'
NAME = 'BestRunning FC'
BASE = 'BestRunning-FC'
VERSION = '2.1'

OBJ = '￼'  # carácter de objeto: hueco de una variable dentro de un texto
NS = uuid.UUID('6f1c2b8e-4c1a-4e55-9a51-0b7e5f3a2c11')  # UUIDs deterministas → compilación reproducible

ICON_RED = 4282601983       # 0xFF4351FF «red» (RGBA), igual que en Cherri y iOS-Shortcuts-Reference
GLYPH_HEART = 59754         # «heart» en la tabla de glifos de Cherri/ScPL
CLIENT_VERSION = '4033.0.4.3'  # iOS 26 según Cherri; el mínimo real lo marca WFWorkflowMinimumClientVersion

# Unidad de «está entre los/as últimos/as N …»: día = 16 (NSCalendarUnitDay), la de los atajos exportados reales.
# No se usa «horas»: ningún atajo exportado real la confirma (el autodiagnóstico usa «es hoy», operador 1002).
UNIT_DAY = 16

WINDOW_LIMIT = 4000   # búsqueda exacta: tope de seguridad (3 h de entreno a 1 lectura/5 s = 2160)
WIDE_DAYS = 3         # búsqueda amplia: últimos 3 días…
WIDE_LIMIT = 2000     # …y como mucho las 2000 lecturas más recientes (el Repetir recorre cada una)

MSG_OK = 'Vuelve a BestRunning y pulsa Pegar'
MSG_WIDE = 'Copiado (búsqueda amplia). Vuelve a BestRunning y pulsa Pegar'
# Ruta oficial de iOS 26 en español (Manual de uso del iPhone, es-es, «Compartir tus datos de salud»): «Abre la app
# Salud… Toca Resumen y, a continuación, toca tu foto o tus iniciales en la esquina superior derecha. En Privacidad,
# toca Apps…». No se da ruta de Ajustes: el manual de iOS 26 no la documenta. «Frecuencia cardiaca» = HEART_RATE (es)
# de HealthKit en macOS 26.5.
MSG_PERMISSION = ('Salud no deja leer tu pulso a Atajos. Abre la app Salud › Resumen › tu foto (arriba a la derecha) '
                  '› Privacidad: Apps › Atajos y activa Frecuencia cardiaca. '
                  'Luego vuelve a BestRunning e importa otra vez.')
MSG_NO_SESSION = ('No hay pulso del Apple Watch de este entreno ni de los últimos {d} días. '
                  'El permiso de Salud está bien: la lectura más reciente es del ').format(d=WIDE_DAYS)
MSG_NO_SESSION_END = '. ¿Llevabas el entreno iniciado en el reloj?'


def uid(name):
    return str(uuid.uuid5(NS, name)).upper()


def gid(name):
    return str(uuid.uuid5(NS, 'group:' + name)).upper()


# ───────────── Variables ─────────────

def out_ref(action, aggr=None):
    """Salida de una acción anterior (variable mágica)."""
    v = {'Type': 'ActionOutput', 'OutputUUID': action['UUID'], 'OutputName': action['OutputName']}
    if aggr:
        v['Aggrandizements'] = aggr
    return v


def var_ref(name, aggr=None):
    v = {'Type': 'Variable', 'VariableName': name}
    if aggr:
        v['Aggrandizements'] = aggr
    return v


def input_ref():
    return {'Type': 'ExtensionInput'}  # «Entrada del atajo»


def attach(v):
    return {'Value': v, 'WFSerializationType': 'WFTextTokenAttachment'}


def utf16len(s):
    return len(s.encode('utf-16-le')) // 2


def tstr(*parts):
    """Texto con variables: partes str o dict (referencia). NSRange en unidades UTF-16."""
    s = ''
    rng = {}
    for p in parts:
        if isinstance(p, str):
            s += p
        else:
            rng['{%d, 1}' % utf16len(s)] = p
            s += OBJ
    val = {'string': s}
    if rng:
        val['attachmentsByRange'] = rng
    return {'Value': val, 'WFSerializationType': 'WFTextTokenString'}


AG_HK = {'Type': 'WFCoercionVariableAggrandizement', 'CoercionItemClass': 'WFHKSampleContentItem'}


def ag_prop(name):
    return {'Type': 'WFPropertyVariableAggrandizement', 'PropertyName': name}


AG_ISO = {'Type': 'WFDateFormatVariableAggrandizement', 'WFDateFormatStyle': 'ISO 8601', 'WFISO8601IncludeTime': True}


# ───────────── Acciones ─────────────

ACTIONS = []


def act(ident, params, key=None, output=None):
    """Añade una acción. key → UUID determinista; output → nombre de su salida (para las referencias)."""
    p = dict(params)
    a = {'WFWorkflowActionIdentifier': 'is.workflow.actions.' + ident, 'WFWorkflowActionParameters': p}
    ACTIONS.append(a)
    if key:
        p['UUID'] = uid(key)
    return {'UUID': p.get('UUID'), 'OutputName': output, 'action': a}


def comment(text):
    act('comment', {'WFCommentActionText': text})


HAS_VALUE = 100      # «tiene algún valor»
HAS_NO_VALUE = 101   # «no tiene ningún valor»
CONTAINS = 99        # «contiene» (texto)


def if_start(group, value_ref, condition, **extra):
    act('conditional', {
        'GroupingIdentifier': gid(group), 'WFControlFlowMode': 0, 'WFCondition': condition,
        'WFInput': {'Type': 'Variable', 'Variable': attach(value_ref)}, **extra,
    })


def if_else(group):
    act('conditional', {'GroupingIdentifier': gid(group), 'WFControlFlowMode': 1})


def if_end(group, key):
    act('conditional', {'GroupingIdentifier': gid(group), 'WFControlFlowMode': 2}, key=key, output='If Result')


def set_var(name, ref):
    act('setvariable', {'WFVariableName': name, 'WFInput': attach(ref)})


def text(key, *parts):
    return act('gettext', {'WFTextActionText': tstr(*parts)}, key=key, output='Text')


def set_text(name, key, *parts):
    """Texto → Definir variable (para no comparar textos en un «Si»)."""
    set_var(name, out_ref(text(key, *parts)))


def notification(key, *body, title=NAME):
    act('notification', {
        'WFNotificationActionTitle': tstr(title),
        'WFNotificationActionBody': tstr(*body),
        'WFNotificationActionSound': True,
    }, key=key)


def alert(key, *message, title=NAME):
    act('alert', {
        'WFAlertActionTitle': tstr(title),
        'WFAlertActionMessage': tstr(*message),
        'WFAlertActionCancelButtonShown': False,
    }, key=key)


def dict_item(key, value_parts, item_type):
    """WFItemType: 0 texto · 3 número (1 = diccionario, 2 = lista, 4 = booleano)."""
    return {'WFItemType': item_type, 'WFKey': tstr(key), 'WFValue': tstr(*value_parts)}


# ───────────── Filtros de Salud ─────────────

def f_type():
    """«Tipo es Frecuencia cardiaca»: idéntica a la fila de un atajo de pulso exportado de un iPhone real
    (suliveevil/My-Siri-Shortcuts, «Heart Rate Data»): Bounded true, Removable false, solo Enumeration."""
    return {'Property': 'Type', 'Operator': 4, 'Removable': False, 'Bounded': True,
            'Values': {'Enumeration': {'Value': 'Heart Rate', 'WFSerializationType': 'WFStringSubstitutableState'}}}


def f_between_vars(start_var, end_var):
    """«Fecha de inicio está entre <start> y <end>» con VARIABLES, en las DOS formas conocidas a la vez.

    · Moderna (atajo de ejemplo hecho por Apple, «Reminder Edits», 2026, citado en viticci/shortcuts-playground-plugin):
      la variable va DENTRO de Values.Date / Values.AnotherDate como WFTextTokenAttachment.
    · Antigua (atajo exportado de extratone/i, cliente 1206): VariableOverrides.dateValue / anotherDateValue.
    Las dos apuntan a la MISMA variable, así que gane la que gane el resultado es el mismo. WFRowTemplateParameterState
    (cabeceras de iOS 17) solo tiene dateValue / anotherDateValue (WFDateSubstitutableState, admite variable)."""
    s, e = attach(var_ref(start_var)), attach(var_ref(end_var))
    return {'Property': 'Start Date', 'Operator': 1003, 'Removable': True, 'Bounded': True,
            'Values': {'Date': s, 'AnotherDate': e},
            'VariableOverrides': {'dateValue': dict(s), 'anotherDateValue': dict(e)}}


def f_last(number, unit):
    """«Fecha de inicio está entre los/as últimos/as <number> <unit>»: constante, sin variables (operador 1001).
    Igual que el atajo de pulso exportado real («in the last 2 days»: Operator 1001, Number 2, Unit 16, Bounded true)."""
    return {'Property': 'Start Date', 'Operator': 1001, 'Removable': True, 'Bounded': True,
            'Values': {'Number': number, 'Unit': unit}}


def f_today():
    """«Fecha de inicio es hoy» (operador 1002). Forma de una exportación real de iOS 26 de Buscar muestras médicas
    (viticci/shortcuts-playground-plugin, HEALTHKIT.md): Values con Number 7 / Unit 16 que el operador ignora."""
    return {'Property': 'Start Date', 'Operator': 1002, 'Removable': True, 'Bounded': True,
            'Values': {'Number': 7, 'Unit': UNIT_DAY}}


def find_hr(key, extra_filters, limit=None, order='Latest First'):
    """Buscar muestras de salud: Frecuencia cardiaca + filtros, ordenadas por Fecha de inicio."""
    p = {
        'WFContentItemFilter': {
            'Value': {
                'WFActionParameterFilterPrefix': 1,  # se cumplen todas
                'WFContentPredicateBoundedDate': False,
                'WFActionParameterFilterTemplates': [f_type(), *extra_filters],
            },
            'WFSerializationType': 'WFContentPredicateTableTemplate',
        },
        'WFContentItemSortProperty': 'Start Date',
        'WFContentItemSortOrder': order,
        'WFContentItemLimitEnabled': limit is not None,
        'WFHKSampleFilteringFillMissing': False,  # como en el atajo de pulso exportado real (sin agrupar)
    }
    if limit is not None:
        p['WFContentItemLimitNumber'] = limit
    return act('filter.health.quantity', p, key=key, output='Health Samples')


def count(key, ref):
    return act('count', {'Input': attach(ref), 'WFCountType': 'Items'}, key=key, output='Count')


# ───────────── El atajo ─────────────

def build():
    ACTIONS.clear()
    comment(
        f'BestRunning FC v{VERSION} · generado por tools/watch/build-shortcut.py (no lo edites a mano: vuelve a generarlo).\n'
        'BestRunning lo abre con el texto {"v":1,"id","start","end"}; lee el pulso del Apple Watch en Salud '
        'y copia {"v":1,"id","avg","max","min","csv","mode"} al portapapeles.\n'
        f'1) entre start y end · 2) si no hay nada, últimos {WIDE_DAYS} días · 3) si tampoco, dice si es el permiso de Salud.\n'
        'Ejecútalo sin entrada (desde Atajos) para ver un autodiagnóstico.'
    )

    # ── v2.1: la entrada llega por la URL de BestRunning (input=text). Si iOS no la pasa, la app también deja
    #    {"v":1,"id","start","end"} en el portapapeles justo antes de abrir el Atajo: se usa ese texto.
    if_start('src', input_ref(), HAS_VALUE)
    set_var('entrada', input_ref())
    if_else('src')
    set_text('entrada', 'entrada-vacia', '')  # definida siempre (vacía = «no tiene ningún valor»)
    clip = act('getclipboard', {}, key='clip', output='Clipboard')
    if_start('clip', out_ref(clip), CONTAINS, WFConditionalActionString='"start"')
    set_var('entrada', out_ref(clip))
    if_end('clip', 'clip-end')
    if_end('src', 'src-end')

    if_start('input', var_ref('entrada'), HAS_VALUE)
    # ── Entrada → diccionario → start, end (fechas: el PRIMER elemento de «Obtener fechas»), id
    dic = act('detect.dictionary', {'WFInput': attach(var_ref('entrada'))}, key='dict', output='Dictionary')
    for k in ('start', 'end'):
        val = act('getvalueforkey', {'WFGetDictionaryValueType': 'Value', 'WFDictionaryKey': k,
                                     'WFInput': attach(out_ref(dic))}, key='get-' + k, output='Dictionary Value')
        dates = act('detect.date', {'WFInput': attach(out_ref(val))}, key='date-' + k, output='Dates')
        first = act('getitemfromlist', {'WFItemSpecifier': 'First Item', 'WFInput': attach(out_ref(dates))},
                    key='first-' + k, output='Item from List')
        set_var(k, out_ref(first))
    sid = act('getvalueforkey', {'WFGetDictionaryValueType': 'Value', 'WFDictionaryKey': 'id',
                                 'WFInput': attach(out_ref(dic))}, key='get-id', output='Dictionary Value')
    set_var('id', out_ref(sid))

    # ── Búsqueda 1: la ventana exacta de la sesión
    hs1 = find_hr('health-window', [f_between_vars('start', 'end')], limit=WINDOW_LIMIT)
    set_var('muestras', out_ref(hs1))
    set_text('modo', 'mode-window', 'window')
    set_text('aviso', 'msg-window', MSG_OK)

    # ── Búsqueda 2 (solo si la 1 no da nada): filtro constante, sin variables
    if_start('wide', out_ref(hs1), HAS_NO_VALUE)
    hs2 = find_hr('health-wide', [f_last(WIDE_DAYS, UNIT_DAY)], limit=WIDE_LIMIT)
    set_var('muestras', out_ref(hs2))
    set_text('modo', 'mode-wide', 'wide')
    set_text('aviso', 'msg-wide', MSG_WIDE)
    if_end('wide', 'wide-end')

    if_start('samples', var_ref('muestras'), HAS_VALUE)
    # ── Estadísticas (la app las recalcula con las lecturas de la sesión; en «wide» son de varios días)
    stats = {}
    for op, k in (('Average', 'avg'), ('Maximum', 'max'), ('Minimum', 'min')):
        stats[k] = act('statistics', {'WFStatisticsOperation': op, 'WFInput': attach(var_ref('muestras'))},
                       key='stat-' + k, output='Statistics')
    # ── Una línea "<Fecha de inicio ISO 8601>,<Valor>" por lectura
    act('repeat.each', {'GroupingIdentifier': gid('repeat'), 'WFControlFlowMode': 0, 'WFInput': attach(var_ref('muestras'))})
    text('line', var_ref('Repeat Item', [AG_HK, ag_prop('Start Date'), AG_ISO]), ',', var_ref('Repeat Item', [AG_HK, ag_prop('Value')]))
    rep = act('repeat.each', {'GroupingIdentifier': gid('repeat'), 'WFControlFlowMode': 2}, key='repeat-end', output='Repeat Results')
    csv = act('text.combine', {'text': attach(out_ref(rep)), 'WFTextSeparator': 'New Lines'}, key='combine', output='Combined Text')
    # ── Diccionario { v:1, id, avg, max, min, csv, mode } → Texto (JSON) → portapapeles
    dic_out = act('dictionary', {'WFItems': {'Value': {'WFDictionaryFieldValueItems': [
        dict_item('v', ['1'], 3),
        dict_item('id', [var_ref('id')], 0),
        dict_item('avg', [out_ref(stats['avg'])], 3),
        dict_item('max', [out_ref(stats['max'])], 3),
        dict_item('min', [out_ref(stats['min'])], 3),
        dict_item('csv', [out_ref(csv)], 0),
        dict_item('mode', [var_ref('modo')], 0),
    ]}, 'WFSerializationType': 'WFDictionaryFieldValue'}}, key='out-dict', output='Dictionary')
    js = text('out-json', out_ref(dic_out))
    act('setclipboard', {'WFInput': attach(out_ref(js)), 'WFLocalOnly': False}, key='clipboard')
    notification('note-ok', var_ref('aviso'))
    if_else('samples')
    # ── Nada en la ventana ni en 3 días: ¿hay ALGUNA lectura de pulso en Salud? (sin filtro de fecha)
    hs3 = find_hr('health-any', [], limit=1)
    if_start('perm', out_ref(hs3), HAS_VALUE)
    notification('note-no-session', MSG_NO_SESSION, out_ref(hs3, [AG_HK, ag_prop('Start Date')]), MSG_NO_SESSION_END)
    if_else('perm')
    notification('note-permission', MSG_PERMISSION)
    if_end('perm', 'perm-end')
    if_end('samples', 'samples-end')

    if_else('input')
    # ── Sin entrada: autodiagnóstico (una alerta). No copia nada.
    d1 = find_hr('diag-today', [f_today()])
    c1 = count('diag-today-count', out_ref(d1))
    d2 = find_hr('diag-3d', [f_last(WIDE_DAYS, UNIT_DAY)])
    c2 = count('diag-3d-count', out_ref(d2))
    d3 = find_hr('diag-any', [], limit=1)
    if_start('diag', out_ref(d3), HAS_VALUE)
    set_text('diagnostico', 'diag-ok', 'Permiso de Salud: bien. Lectura más reciente: ',
             out_ref(d3, [AG_HK, ag_prop('Start Date')]), '.')
    if_else('diag')
    set_text('diagnostico', 'diag-perm', 'No se ve NINGUNA lectura de pulso. ' + MSG_PERMISSION)
    if_end('diag', 'diag-end')
    alert('diag-alert', 'Lecturas de Frecuencia cardiaca en Salud:\n'
          '· hoy: ', out_ref(c1), '\n'
          f'· últimos {WIDE_DAYS} días: ', out_ref(c2), '\n\n', var_ref('diagnostico'),
          '\n\nEsto es solo una prueba: no se ha copiado nada. Para importar un entreno, ábrelo desde BestRunning.',
          title=f'{NAME} · autodiagnóstico')
    if_end('input', 'input-end')

    return {
        'WFWorkflowName': NAME,
        'WFWorkflowClientVersion': CLIENT_VERSION,
        'WFWorkflowMinimumClientVersion': 900,
        'WFWorkflowMinimumClientVersionString': '900',
        'WFWorkflowIcon': {'WFWorkflowIconStartColor': ICON_RED, 'WFWorkflowIconGlyphNumber': GLYPH_HEART},
        'WFWorkflowImportQuestions': [],
        'WFWorkflowTypes': ['ActionExtension'],  # v2.1: sin una fuente de entrada iOS no pasa el texto de la URL
        'WFWorkflowInputContentItemClasses': ['WFStringContentItem'],
        'WFWorkflowOutputContentItemClasses': [],
        'WFWorkflowHasShortcutInputVariables': True,
        'WFWorkflowHasOutputFallback': False,
        'WFQuickActionSurfaces': [],
        'WFWorkflowActions': list(ACTIONS),
    }


# ───────────── Validación ─────────────

def walk_refs(node, path=''):
    """Todas las referencias a variables (dicts con Type ActionOutput/Variable/ExtensionInput)."""
    if isinstance(node, dict):
        if node.get('Type') in ('ActionOutput', 'Variable', 'ExtensionInput') and ('OutputUUID' in node or 'VariableName' in node or node.get('Type') == 'ExtensionInput'):
            yield path, node
        for k, v in node.items():
            yield from walk_refs(v, f'{path}.{k}')
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk_refs(v, f'{path}[{i}]')


OUTPUT_KEYS = ['v', 'id', 'avg', 'max', 'min', 'csv', 'mode']


def validate(wf):
    errs = []
    acts = wf['WFWorkflowActions']
    seen_uuid = {}
    set_vars = set()
    stack = []
    groups = {}
    builtin = {'Repeat Item', 'Repeat Index'}
    for i, a in enumerate(acts):
        ident = a['WFWorkflowActionIdentifier']
        p = a['WFWorkflowActionParameters']
        if not ident.startswith('is.workflow.actions.'):
            errs.append(f'#{i}: identificador raro {ident}')
        for path, r in walk_refs(p):
            if r['Type'] == 'ActionOutput':
                if r['OutputUUID'] not in seen_uuid:
                    errs.append(f'#{i} {ident}{path}: UUID {r["OutputUUID"]} no es de una acción anterior')
                elif not r.get('OutputName'):
                    errs.append(f'#{i}{path}: referencia sin OutputName')
            elif r['Type'] == 'Variable':
                n = r['VariableName']
                if n in builtin:
                    if not any(s[0] == 'repeat' for s in stack):
                        errs.append(f'#{i}{path}: «{n}» fuera de un Repetir')
                elif n not in set_vars:
                    errs.append(f'#{i}{path}: variable «{n}» sin «Definir variable» anterior')
        # Bloques
        if 'WFControlFlowMode' in p:
            g = p.get('GroupingIdentifier')
            mode = p['WFControlFlowMode']
            kind = 'repeat' if ident.endswith('repeat.each') else 'if' if ident.endswith('conditional') else ident
            if not isinstance(mode, int):
                errs.append(f'#{i}: WFControlFlowMode debe ser entero')
            if mode == 0:
                if g in groups:
                    errs.append(f'#{i}: GroupingIdentifier {g} reutilizado')
                stack.append((kind, g))
                groups[g] = [mode]
            else:
                if not stack or stack[-1] != (kind, g):
                    errs.append(f'#{i}: bloque {kind} {g} mal anidado (pila {stack})')
                else:
                    if mode in groups[g]:
                        errs.append(f'#{i}: modo {mode} repetido en el bloque {g}')
                    groups[g].append(mode)
                    if mode == 2:
                        stack.pop()
                if mode == 1 and kind != 'if':
                    errs.append(f'#{i}: «Si no» fuera de un Si')
        if ident.endswith('setvariable'):
            set_vars.add(p['WFVariableName'])
        if 'UUID' in p:
            if p['UUID'] in seen_uuid:
                errs.append(f'#{i}: UUID repetido')
            seen_uuid[p['UUID']] = i
        # Texto con variables: rangos coherentes
        for path, node in walk_tokens(p):
            s = node['string']
            for rk in node.get('attachmentsByRange', {}):
                loc, ln = (int(x) for x in rk.strip('{}').split(','))
                u16 = s.encode('utf-16-le')
                if ln != 1 or u16[loc * 2:loc * 2 + 2].decode('utf-16-le') != OBJ:
                    errs.append(f'#{i}{path}: rango {rk} no apunta a un hueco de variable')
            if s.count(OBJ) != len(node.get('attachmentsByRange', {})):
                errs.append(f'#{i}{path}: huecos ￼ sin variable')
    if stack:
        errs.append(f'bloques sin cerrar: {stack}')
    for g, modes in groups.items():
        if modes[-1] != 2:
            errs.append(f'grupo {g} sin final')
    # Filtros de Salud
    hs = {a['WFWorkflowActionParameters'].get('UUID'): a['WFWorkflowActionParameters'] for a in acts
          if a['WFWorkflowActionIdentifier'].endswith('filter.health.quantity')}
    want = {uid(k) for k in ('health-window', 'health-wide', 'health-any', 'diag-today', 'diag-3d', 'diag-any')}
    if set(hs) != want:
        errs.append(f'«Buscar muestras de salud»: {len(hs)} acciones, se esperaban {len(want)}')
    for u, p in hs.items():
        tpl = p['WFContentItemFilter']['Value']['WFActionParameterFilterTemplates']
        ty = [t for t in tpl if t['Property'] == 'Type']
        if len(ty) != 1 or ty[0]['Values']['Enumeration']['Value'] != 'Heart Rate' or ty[0]['Operator'] != 4:
            errs.append(f'{u}: el filtro no es «Tipo es Frecuencia cardiaca»')
        if any(t.get('Bounded') is not True for t in tpl):
            errs.append(f'{u}: fila de filtro sin Bounded true (los atajos exportados reales lo llevan)')
        if p.get('WFHKSampleFilteringFillMissing') is not False:
            errs.append(f'{u}: falta WFHKSampleFilteringFillMissing false')
        if p['WFContentItemSortProperty'] != 'Start Date' or p['WFContentItemSortOrder'] not in ('Latest First', 'Oldest First'):
            errs.append(f'{u}: orden raro')
        if p['WFContentItemLimitEnabled'] != ('WFContentItemLimitNumber' in p):
            errs.append(f'{u}: límite incoherente')
        for t in tpl:
            if t['Property'] != 'Start Date':
                continue
            if t['Operator'] == 1003:
                vo = t.get('VariableOverrides', {})
                vv = t.get('Values', {})
                for where, lo, hi in (('VariableOverrides', vo.get('dateValue'), vo.get('anotherDateValue')),
                                      ('Values', vv.get('Date'), vv.get('AnotherDate'))):
                    if (lo or {}).get('Value') != var_ref('start') or (hi or {}).get('Value') != var_ref('end') \
                            or {(lo or {}).get('WFSerializationType'), (hi or {}).get('WFSerializationType')} != {'WFTextTokenAttachment'}:
                        errs.append(f'{u}: «está entre» no usa start/end (WFTextTokenAttachment) en {where}')
                if not {'start', 'end'} <= set_vars:
                    errs.append('start/end no se definen antes del filtro')
            elif t['Operator'] in (1001, 1002):
                v = t['Values']
                if not (isinstance(v.get('Number'), int) and v['Number'] > 0 and v.get('Unit') == UNIT_DAY):
                    errs.append(f'{u}: «en los últimos» / «es hoy» sin Number/Unit (día = 16) válidos')
                if walk_refs_any(t):
                    errs.append(f'{u}: el filtro amplio no debe usar variables')
            else:
                errs.append(f'{u}: operador de fecha {t["Operator"]} inesperado')
    wide = hs.get(uid('health-wide'))
    if wide and (wide['WFContentItemSortOrder'] != 'Latest First' or wide.get('WFContentItemLimitNumber') != WIDE_LIMIT):
        errs.append('la búsqueda amplia debe ir de la más reciente a la más antigua y con límite')
    # Diccionario de salida = contrato de la app (+ mode)
    d = [a for a in acts if a['WFWorkflowActionIdentifier'].endswith('.dictionary')]
    keys = [it['WFKey']['Value']['string'] for it in d[-1]['WFWorkflowActionParameters']['WFItems']['Value']['WFDictionaryFieldValueItems']] if d else []
    if keys != OUTPUT_KEYS:
        errs.append(f'claves de salida {keys}')
    # Una sola copia al portapapeles, dentro de «hay muestras»
    clip = [i for i, a in enumerate(acts) if a['WFWorkflowActionIdentifier'].endswith('setclipboard')]
    if len(clip) != 1:
        errs.append(f'{len(clip)} «Copiar al portapapeles» (debe haber 1)')
    if 'WFStringContentItem' not in wf['WFWorkflowInputContentItemClasses']:
        errs.append('no acepta texto como entrada')
    return errs


def walk_refs_any(node):
    return any(True for _ in walk_refs(node))


def walk_tokens(node, path=''):
    if isinstance(node, dict):
        if node.get('WFSerializationType') == 'WFTextTokenString':
            yield path, node['Value']
        for k, v in node.items():
            yield from walk_tokens(v, f'{path}.{k}')
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk_tokens(v, f'{path}[{i}]')


def summary(wf):
    """Lista legible de acciones (la que aparece en el README)."""
    lines = []
    depth = 0
    for i, a in enumerate(wf['WFWorkflowActions']):
        ident = a['WFWorkflowActionIdentifier'].replace('is.workflow.actions.', '')
        p = a['WFWorkflowActionParameters']
        mode = p.get('WFControlFlowMode')
        if mode in (1, 2):
            depth -= 1
        lines.append(f'{i:2d} {"  " * depth}{ident}' + (f' [{["inicio", "si no", "fin"][mode]}]' if mode is not None else ''))
        if mode in (0, 1):
            depth += 1
    return '\n'.join(lines)


def main():
    sign = '--sign' in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    wf = build()
    errs = validate(wf)
    unsigned = OUT / f'{BASE}.unsigned.shortcut'
    with open(unsigned, 'wb') as f:
        plistlib.dump(wf, f, fmt=plistlib.FMT_BINARY, sort_keys=True)
    # Re-parseo del binario y validación otra vez sobre lo que se ha escrito
    with open(unsigned, 'rb') as f:
        again = plistlib.load(f)
    if again != wf:
        errs.append('el plist binario no coincide al releerlo')
    errs += [f'(releído) {e}' for e in validate(again)]
    xml = OUT / f'{BASE}.xml.plist'
    shutil.copyfile(unsigned, xml)
    subprocess.run(['plutil', '-convert', 'xml1', str(xml)], check=True)
    for p in (unsigned, xml):
        r = subprocess.run(['plutil', '-lint', str(p)], capture_output=True, text=True)
        if r.returncode != 0:
            errs.append(f'plutil -lint {p.name}: {r.stdout.strip()} {r.stderr.strip()}')
    (OUT / f'{BASE}.json').write_text(json.dumps(again, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(summary(again))
    print(f'{len(again["WFWorkflowActions"])} acciones')
    if errs:
        print('\nERRORES:\n  ' + '\n  '.join(errs), file=sys.stderr)
        return 1
    print('validación OK · plutil -lint OK')
    if not sign:
        return 0
    signed = OUT / f'{BASE}.shortcut'
    signed.unlink(missing_ok=True)
    # El servicio de firma no ve archivos de discos externos («The file doesn't exist»): se firma en una carpeta temporal.
    # Tampoco siempre ve $TMPDIR (/var/folders/…); /private/tmp sí. BR_SIGN_TMP permite elegir otra carpeta.
    bases = [b for b in (os.environ.get('BR_SIGN_TMP'), '/private/tmp', None) if b is None or os.path.isdir(b)]
    fails = []
    for base in bases:
        try:
            with tempfile.TemporaryDirectory(dir=base, prefix='br-sign-') as tmp:
                src = Path(tmp) / 'in.shortcut'
                dst = Path(tmp) / 'out.shortcut'
                shutil.copyfile(unsigned, src)
                r = subprocess.run(['/usr/bin/shortcuts', 'sign', '--mode', 'anyone', '--input', str(src), '--output', str(dst)],
                                   capture_output=True, text=True)
                if r.returncode == 0 and dst.exists() and dst.stat().st_size > 0:
                    shutil.copyfile(dst, signed)
                    break
                fails.append(f'{tmp}: ({r.returncode}) {r.stdout.strip()} {r.stderr.strip()}')
        except OSError as e:
            fails.append(f'{base}: {e}')
    if not signed.exists():
        print('firma FALLIDA:\n  ' + '\n  '.join(fails), file=sys.stderr)
        return 2
    head = signed.read_bytes()[:4]
    if head != b'AEA1':
        print(f'aviso: el firmado no empieza por AEA1 ({head!r})', file=sys.stderr)
    shutil.copyfile(signed, OUT / f'{NAME}.shortcut')
    print(f'firmado: {signed.name} y «{NAME}.shortcut» ({signed.stat().st_size} bytes, {head!r})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
