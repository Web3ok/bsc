import re

with open('test/SimpleDEX.test.js', 'r') as f:
    content = f.read()

# Fix the duplicate address issue (user1.address appears twice)
content = re.sub(r',\s*\n\s*user1\.address\);', ');', content)
content = re.sub(r',\s*\n\s*user2\.address\);', ');', content)
content = re.sub(r',\s*user1\.address,\s*\n\s*user1\.address\)', ', user1.address)', content)
content = re.sub(r',\s*user2\.address,\s*\n\s*user2\.address\)', ', user2.address)', content)

# Fix the zero amounts test that has extra parameters
content = content.replace('pool.connect(user1).addLiquidity(0, LIQUIDITY_AMOUNT, 0, 0, deadline, user1.address,\n        user1.address)', 
                          'pool.connect(user1).addLiquidity(0, LIQUIDITY_AMOUNT, 0, 0, deadline, user1.address)')

# Fix removeLiquidity calls with duplicate address
content = content.replace('removeLiquidity(lpBalance, 0, 0, pastDeadline, user1.address,\n        user1.address)',
                          'removeLiquidity(lpBalance, 0, 0, pastDeadline, user1.address)')
                          
content = content.replace('removeLiquidity(lpBalance + 1n, 0, 0, deadline, user1.address,\n        user1.address)',
                          'removeLiquidity(lpBalance + 1n, 0, 0, deadline, user1.address)')

with open('test/SimpleDEX.test.js', 'w') as f:
    f.write(content)
    
print("Cleaned up duplicate parameters")
