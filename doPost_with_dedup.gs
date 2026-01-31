// Apps Script example: doPost with anon_id and signature-based deduplication
// Replace SPREADSHEET_ID with your target spreadsheet ID.

const SPREADSHEET_ID = 'TU_SPREADSHEET_ID_AQUI'; // <-- reemplaza
const COLLECTOR_TOKEN = ''; // optional: set a token and check below

function doPost(e){
  try{
    // Optional token check
    if(COLLECTOR_TOKEN){
      var provided = (e.parameter && e.parameter.token) || null;
      if(!provided) {
        // try to extract from postData if url-encoded
        if(e.postData && e.postData.contents){
          try{ var decoded = decodeURIComponent(e.postData.contents); var m = decoded.match(/token=([^&]+)/); if(m) provided = m[1]; }catch(ex){}
        }
      }
      if(provided !== COLLECTOR_TOKEN){
        return ContentService.createTextOutput(JSON.stringify({ ok:false, error: 'Invalid token' })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // Open spreadsheet by ID (explicit)
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('responses');
    if(!sheet){
      sheet = ss.insertSheet('responses');
      sheet.appendRow([
        'receipt_id','timestamp_server','timestamp_client','consent',
        'pais','sector','tamano','rol','ant_org','ant_cargo','tipo_td','complejidad','duracion','presupuesto',
        'responses_json','comments','anon_id','signature','is_duplicate','first_receipt'
      ]);
    }

    // Parse payload (supports form-urlencoded payload or raw JSON)
    var parsed = null;
    if(e.parameter && e.parameter.payload){
      parsed = JSON.parse(e.parameter.payload);
    } else if(e.postData && e.postData.contents){
      try{ parsed = JSON.parse(e.postData.contents); }
      catch(ex){
        var decoded = decodeURIComponent(e.postData.contents);
        if(decoded.indexOf('payload=') === 0) decoded = decoded.slice(8);
        parsed = JSON.parse(decoded);
      }
    } else {
      throw new Error('No payload received');
    }

    var payload = parsed.payload || parsed || {};
    var meta = payload.meta || {};
    var demo = payload.demographics || {};
    var responses = payload.responses || {};
    var comments = payload.comments || '';
    var anon_id = payload.anon_id || null;

    // Build a canonical signature from demographics+responses
    var signatureString = JSON.stringify({ demographics: demo, responses: responses });
    var signature = sha256(signatureString);

    // Read existing rows to detect duplicates
    var data = sheet.getDataRange().getValues();
    var header = data[0] || [];
    var colIndex = {};
    for(var i=0;i<header.length;i++){ colIndex[header[i]] = i; }

    // ensure columns exist
    var needed = ['anon_id','signature','is_duplicate','first_receipt'];
    var added = false;
    needed.forEach(function(name){ if(!(name in colIndex)){ sheet.getRange(1, header.length+1).setValue(name); header.push(name); colIndex[name]=header.length-1; added = true; } });
    if(added) data = sheet.getDataRange().getValues();

    // Search for existing by anon_id or signature
    var isDuplicate = false;
    var firstReceipt = null;
    for(var r=1;r<data.length;r++){
      var row = data[r];
      var existingAnon = colIndex['anon_id'] in colIndex ? row[colIndex['anon_id']] : '';
      var existingSig = colIndex['signature'] in colIndex ? row[colIndex['signature']] : '';
      var existingReceipt = row[0];
      if(anon_id && existingAnon && anon_id == existingAnon){
        isDuplicate = true; firstReceipt = existingReceipt; break;
      }
      if(existingSig && signature && existingSig == signature){
        isDuplicate = true; firstReceipt = existingReceipt; break;
      }
    }

    var receipt = Utilities.getUuid();
    var now = new Date();

    var rowValues = [];
    rowValues.push(receipt);
    rowValues.push(now.toISOString());
    rowValues.push(meta.timestamp_iso || '');
    rowValues.push(payload.consent ? 1 : 0);

    // demographics fields
    rowValues.push(demo.pais || ''); rowValues.push(demo.sector || ''); rowValues.push(demo.tamano || ''); rowValues.push(demo.rol || '');
    rowValues.push(demo.ant_org || ''); rowValues.push(demo.ant_cargo || ''); rowValues.push(demo.tipo_td || '');
    rowValues.push(demo.complejidad || ''); rowValues.push(demo.duracion || ''); rowValues.push(demo.presupuesto || '');

    rowValues.push(JSON.stringify(responses));
    rowValues.push(comments);
    rowValues.push(anon_id || '');
    rowValues.push(signature || '');
    rowValues.push(isDuplicate ? 'TRUE' : '');
    rowValues.push(firstReceipt || '');

    sheet.appendRow(rowValues);

    return ContentService.createTextOutput(JSON.stringify({ ok:true, receipt_id: receipt, duplicate: isDuplicate, first_receipt: firstReceipt })).setMimeType(ContentService.MimeType.JSON);

  }catch(err){
    return ContentService.createTextOutput(JSON.stringify({ ok:false, error: String(err) })).setMimeType(ContentService.MimeType.JSON);
  }
}

function sha256(text){
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return raw.map(function(b){ var v=(b<0)?b+256:b; return ('0'+v.toString(16)).slice(-2); }).join('');
}
