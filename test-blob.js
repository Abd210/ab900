const { put, list, head } = require('@vercel/blob');
const fs = require('fs');

async function testBlob() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  
  // Write a blob
  const { url, downloadUrl } = await put('test.json', JSON.stringify({ hello: 'private blob world' }), {
    access: 'private',
    token
  });
  console.log("Uploaded:", url);
  
  // Fetch using the token
  const res = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  console.log("Read back:", data);
}

testBlob().catch(console.error);
