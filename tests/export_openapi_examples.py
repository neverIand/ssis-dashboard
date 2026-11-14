"""Write the OpenAPI response examples as JSON for the browser reader tests.

Node has no YAML parser here, so web/tests/openapi-examples.json is a generated copy of
components.examples in docs/openapi.yaml. tests/test_api_contract.py fails when the two differ.

    python -m tests.export_openapi_examples
"""
import json
from pathlib import Path

import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT_ROOT / 'docs/openapi.yaml'
TARGET = PROJECT_ROOT / 'web/tests/openapi-examples.json'


def examples():
    spec = yaml.safe_load(SOURCE.read_text(encoding='utf-8'))
    return {name: example['value'] for name, example in spec['components']['examples'].items()}


def main():
    TARGET.write_text(json.dumps(examples(), indent=1, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')


if __name__ == '__main__':
    main()
