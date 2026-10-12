import json
import sys
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service

options = Options()
options.add_argument('-headless')
options.set_preference('xpinstall.signatures.required', True)
with webdriver.Firefox(options=options, service=Service(service_args=['--allow-system-access'])) as driver:
    driver.set_context('chrome')
    assert driver.execute_script('return typeof ChromeUtils.importESModule === "function"')
    if '--probe' in sys.argv:
        print('Firefox release verification APIs ready:', driver.capabilities['browserVersion'])
        sys.exit(0)
    report_path = Path('verified/verification.json')
    report = json.loads(report_path.read_text())
    xpi = next(Path('verified').glob('*-firefox-signed.xpi')).resolve()
    addon_id = driver.install_addon(str(xpi), temporary=False)
    assert addon_id == report['firefoxId'], addon_id
    driver.set_context('chrome')
    addon = driver.execute_async_script('''
      const done = arguments[arguments.length - 1];
      const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
      AddonManager.getAddonByID(arguments[0]).then(a => done({
        id: a.id, version: a.version, signedState: a.signedState,
        signed: a.signedState === AddonManager.SIGNEDSTATE_SIGNED,
        active: a.isActive, appDisabled: a.appDisabled
      }));
    ''', addon_id)
    assert addon['signed'] and addon['active'] and not addon['appDisabled'], addon
    assert addon['version'] == report['version'], addon
    report['firefoxSignatureVerification'] = addon
    report['firefoxVersion'] = driver.capabilities['browserVersion']
report_path.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
