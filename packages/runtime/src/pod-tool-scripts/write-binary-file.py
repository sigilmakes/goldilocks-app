import base64
import os
import sys

path = sys.argv[1]
encoded = sys.argv[2]
parent = os.path.dirname(path)
if parent:
    os.makedirs(parent, exist_ok=True)
with open(path, 'wb') as handle:
    handle.write(base64.b64decode(encoded))
print('ok')
