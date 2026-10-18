#!/usr/bin/env python3
"""BestRunning · VERSIÓN 1 (archivada) del Atajo «BestRunning FC». La actual es build-shortcut.py (v2).

Se guarda solo para poder reproducir la v1 que falló el 18-10-2026 («no hay pulso…»): sus fechas de
«está entre» iban en Values.Date/AnotherDate, no en VariableOverrides. Escribe en tools/watch/out/v1/ y
NO firma salvo que se pase --sign.


Contrato (js/integrations/watch-hr.js):
  entrada  texto JSON {"v":1,"id":"ses_…","start":"2026-10-18T11:33:00+02:00","end":"…"}  (Entrada del atajo)
  salida   portapapeles con el JSON {"v":1,"id","avg","max","min","csv"}; csv = líneas "<ISO 8601>,<valor>"
  sin entrada (ejecutado a mano desde Atajos): últimas 2 horas, id "prueba".

Solo usa la biblioteca estándar (plistlib). Uso:
  python3 tools/watch/build-shortcut.py            # genera, valida y firma (shortcuts sign --mode anyone)
  python3 tools/watch/build-shortcut.py --no-sign  # genera y valida, sin firmar

Salidas en tools/watch/out/:
  BestRunning-FC.unsigned.shortcut   plist binario sin firmar (lo que se firma)
  BestRunning-FC.xml.plist           volcado XML para revisar (plutil -convert xml1 de una copia)
  BestRunning-FC.json                volcado JSON (mismo contenido, más fácil de leer y de testear)
  BestRunning-FC.shortcut            firmado (nombre pedido por el proyecto)
  BestRunning FC.shortcut            la misma firma con el nombre exacto del Atajo: ESTE es el que se importa,
                                     porque Atajos suele usar el nombre del archivo como nombre del atajo.

Las claves y valores salen de referencias públicas y de las cadenas de WorkflowKit/ActionKit de macOS 26
(ver tools/watch/README.md, «Fuentes»).
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
OUT = HERE / 'out' / 'v1'
NAME = 'BestRunning FC'
BASE = 'BestRunning-FC'

OBJ = '￼'  # carácter de objeto: hueco de una variable dentro de un texto
NS = uuid.UUID('6f1c2b8e-4c1a-4e55-9a51-0b7e5f3a2c11')  # UUIDs deterministas → compilación reproducible

ICON_RED = 4282601983       # 0xFF4351FF «red» (RGBA), igual que en Cherri y iOS-Shortcuts-Reference
GLYPH_HEART = 59754         # «heart» en la tabla de glifos de Cherri/ScPL
CLIENT_VERSION = '4033.0.4.3'  # iOS 26 según Cherri; el mínimo real lo marca WFWorkflowMinimumClientVersion

FALLBACK_HOURS = 2


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


def notification(body, title=NAME):
    act('notification', {
        'WFNotificationActionTitle': tstr(title),
        'WFNotificationActionBody': tstr(body),
        'WFNotificationActionSound': True,
    })


def dict_item(key, value_parts, item_type):
    """WFItemType: 0 texto · 3 número (1 = diccionario, 2 = lista, 4 = booleano)."""
    return {'WFItemType': item_type, 'WFKey': tstr(key), 'WFValue': tstr(*value_parts)}


def build():
    ACTIONS.clear()
    comment(
        'BestRunning FC · generado por tools/watch/build-shortcut.py (no lo edites a mano: vuelve a generarlo).\n'
        'BestRunning lo abre con el texto {"v":1,"id","start","end"}; lee el pulso del Apple Watch en Salud '
        'entre start y end y copia {"v":1,"id","avg","max","min","csv"} al portapapeles.\n'
        f'Si lo ejecutas sin entrada (para probar), usa las últimas {FALLBACK_HOURS} horas.'
    )

    # 1-4 · Entrada → diccionario → start, end, id   (o, sin entrada, las últimas 2 horas)
    if_start('input', input_ref(), 100)  # «tiene algún valor»
    dic = act('detect.dictionary', {'WFInput': attach(input_ref())}, key='dict', output='Dictionary')
    for k in ('start', 'end'):
        val = act('getvalueforkey', {'WFGetDictionaryValueType': 'Value', 'WFDictionaryKey': k,
                                     'WFInput': attach(out_ref(dic))}, key='get-' + k, output='Dictionary Value')
        date = act('detect.date', {'WFInput': attach(out_ref(val))}, key='date-' + k, output='Dates')
        set_var(k, out_ref(date))
    sid = act('getvalueforkey', {'WFGetDictionaryValueType': 'Value', 'WFDictionaryKey': 'id',
                                 'WFInput': attach(out_ref(dic))}, key='get-id', output='Dictionary Value')
    set_var('id', out_ref(sid))
    if_else('input')
    now = act('date', {'WFDateActionMode': 'Current Date'}, key='now', output='Date')
    set_var('end', out_ref(now))
    ago = act('adjustdate', {
        'WFAdjustOperation': 'Subtract',
        'WFDuration': {'Value': {'Magnitude': str(FALLBACK_HOURS), 'Unit': 'hr'}, 'WFSerializationType': 'WFQuantityFieldValue'},
        'WFDate': tstr(out_ref(now)),
    }, key='ago', output='Adjusted Date')
    set_var('start', out_ref(ago))
    test_id = text('test-id', 'prueba')
    set_var('id', out_ref(test_id))
    if_end('input', 'input-end')

    # 5 · Buscar muestras de salud: Frecuencia cardiaca, Fecha de inicio entre start y end, más antiguas primero
    hs = act('filter.health.quantity', {
        'WFContentItemFilter': {
            'Value': {
                'WFActionParameterFilterPrefix': 1,  # se cumplen todas
                'WFContentPredicateBoundedDate': False,
                'WFActionParameterFilterTemplates': [
                    {'Property': 'Type', 'Operator': 4, 'Removable': False,
                     'Values': {'Unit': 4, 'Enumeration': {'Value': 'Heart Rate', 'WFSerializationType': 'WFStringSubstitutableState'}}},
                    {'Property': 'Start Date', 'Operator': 1003, 'Removable': True,  # «está entre»
                     'Values': {'Unit': 4, 'Date': attach(var_ref('start')), 'AnotherDate': attach(var_ref('end'))}},
                ],
            },
            'WFSerializationType': 'WFContentPredicateTableTemplate',
        },
        'WFContentItemSortProperty': 'Start Date',
        'WFContentItemSortOrder': 'Oldest First',
        'WFContentItemLimitEnabled': False,
    }, key='health', output='Health Samples')

    if_start('samples', out_ref(hs), 100)

    # 6 · Estadísticas
    stats = {}
    for op, k in (('Average', 'avg'), ('Maximum', 'max'), ('Minimum', 'min')):
        stats[k] = act('statistics', {'WFStatisticsOperation': op, 'WFInput': attach(out_ref(hs))}, key='stat-' + k, output='Statistics')

    # 7 · Repetir con cada muestra: "<Fecha de inicio ISO 8601>,<Valor>"
    act('repeat.each', {'GroupingIdentifier': gid('repeat'), 'WFControlFlowMode': 0, 'WFInput': attach(out_ref(hs))})
    text('line', var_ref('Repeat Item', [AG_HK, ag_prop('Start Date'), AG_ISO]), ',', var_ref('Repeat Item', [AG_HK, ag_prop('Value')]))
    rep = act('repeat.each', {'GroupingIdentifier': gid('repeat'), 'WFControlFlowMode': 2}, key='repeat-end', output='Repeat Results')

    # 8 · Combinar con saltos de línea
    csv = act('text.combine', {'text': attach(out_ref(rep)), 'WFTextSeparator': 'New Lines'}, key='combine', output='Combined Text')

    # 9 · Diccionario { v:1, id, avg, max, min, csv }
    dic_out = act('dictionary', {'WFItems': {'Value': {'WFDictionaryFieldValueItems': [
        dict_item('v', ['1'], 3),
        dict_item('id', [var_ref('id')], 0),
        dict_item('avg', [out_ref(stats['avg'])], 3),
        dict_item('max', [out_ref(stats['max'])], 3),
        dict_item('min', [out_ref(stats['min'])], 3),
        dict_item('csv', [out_ref(csv)], 0),
    ]}, 'WFSerializationType': 'WFDictionaryFieldValue'}}, key='out-dict', output='Dictionary')

    # 10 · Copiar al portapapeles (como texto JSON: un Diccionario dentro de «Texto» se convierte en JSON)
    js = text('out-json', out_ref(dic_out))
    act('setclipboard', {'WFInput': attach(out_ref(js)), 'WFLocalOnly': False})

    # 11 · Notificación
    notification('Vuelve a BestRunning y pulsa Pegar')
    if_else('samples')
    notification('No hay pulso del Apple Watch en ese horario. ¿Grabaste el entreno en el reloj? Vuelve a BestRunning.')
    if_end('samples', 'samples-end')

    return {
        'WFWorkflowName': NAME,
        'WFWorkflowClientVersion': CLIENT_VERSION,
        'WFWorkflowMinimumClientVersion': 900,
        'WFWorkflowMinimumClientVersionString': '900',
        'WFWorkflowIcon': {'WFWorkflowIconStartColor': ICON_RED, 'WFWorkflowIconGlyphNumber': GLYPH_HEART},
        'WFWorkflowImportQuestions': [],
        'WFWorkflowTypes': [],
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
                    errs.append(f'#{i}{path}: variable «{n}» sin «Ajustar variable» anterior')
        # Bloques
        if 'WFControlFlowMode' in p:
            g = p.get('GroupingIdentifier')
            mode = p['WFControlFlowMode']
            kind = 'repeat' if ident.endswith('repeat.each') else 'if' if ident.endswith('conditional') else ident
            if not isinstance(mode, int):
                errs.append(f'#{i}: WFControlFlowMode debe ser entero')
            if mode == 0:
                stack.append((kind, g))
                groups[g] = [mode]
            else:
                if not stack or stack[-1] != (kind, g):
                    errs.append(f'#{i}: bloque {kind} {g} mal anidado (pila {stack})')
                else:
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
    if stack:
        errs.append(f'bloques sin cerrar: {stack}')
    for g, modes in groups.items():
        if modes[-1] != 2:
            errs.append(f'grupo {g} sin final')
    # Filtro de Salud
    hs = [a for a in acts if a['WFWorkflowActionIdentifier'].endswith('filter.health.quantity')]
    if len(hs) != 1:
        errs.append('debe haber una sola «Buscar muestras de salud»')
    else:
        tpl = hs[0]['WFWorkflowActionParameters']['WFContentItemFilter']['Value']['WFActionParameterFilterTemplates']
        ty = [t for t in tpl if t['Property'] == 'Type']
        dt = [t for t in tpl if t['Property'] == 'Start Date']
        if not ty or ty[0]['Values']['Enumeration']['Value'] != 'Heart Rate' or ty[0]['Operator'] != 4:
            errs.append('el filtro no es «Tipo es Frecuencia cardiaca»')
        if not dt or dt[0]['Operator'] != 1003:
            errs.append('falta «Fecha de inicio está entre»')
        else:
            v = dt[0]['Values']
            if v['Date']['Value'] != var_ref('start') or v['AnotherDate']['Value'] != var_ref('end'):
                errs.append('«está entre» no usa las variables start y end')
            if not {'start', 'end'} <= set_vars:
                errs.append('start/end no se ajustan antes del filtro')
    # Diccionario de salida = contrato de la app
    d = [a for a in acts if a['WFWorkflowActionIdentifier'].endswith('.dictionary')]
    keys = [it['WFKey']['Value']['string'] for it in d[-1]['WFWorkflowActionParameters']['WFItems']['Value']['WFDictionaryFieldValueItems']] if d else []
    if keys != ['v', 'id', 'avg', 'max', 'min', 'csv']:
        errs.append(f'claves de salida {keys}')
    if 'WFStringContentItem' not in wf['WFWorkflowInputContentItemClasses']:
        errs.append('no acepta texto como entrada')
    return errs


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
