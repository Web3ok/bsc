import re

with open('test/SimpleDEX.test.js', 'r') as f:
    content = f.read()

# Pattern to match addLiquidity calls with 5 parameters (missing address)
pattern = re.compile(
    r'(pool\.connect\((user[12])\)\.addLiquidity\(\s*' +
    r'[^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*[^)]+)(\s*\))',
    re.MULTILINE | re.DOTALL
)

# Replace with the same call plus the address parameter
def replace_func(match):
    user = match.group(2)
    return match.group(1) + ',\n        ' + user + '.address' + match.group(3)

content = pattern.sub(replace_func, content)

# Pattern to match removeLiquidity calls with 4 parameters (missing address)
pattern2 = re.compile(
    r'(pool\.connect\((user[12])\)\.removeLiquidity\(\s*' +
    r'[^,]+,\s*[^,]+,\s*[^,]+,\s*[^)]+)(\s*\))',
    re.MULTILINE | re.DOTALL
)

content = pattern2.sub(replace_func, content)

with open('test/SimpleDEX.test.js', 'w') as f:
    f.write(content)
    
print("Fixed all addLiquidity and removeLiquidity calls")
