import base64
import sys

path = sys.argv[1]
with open(path, 'rb') as handle:
    sys.stdout.write(base64.b64encode(handle.read()).decode('ascii'))
