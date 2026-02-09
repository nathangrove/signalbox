import os
import re
import joblib
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

MODEL_PATH = os.environ.get('MODEL_PATH', '/app/models/email_models.joblib')
URL_RE = re.compile(r'https?://\S+|\bwww\.\S+', re.I)

app = FastAPI(title="email-classifier")

class Req(BaseModel):
    subject: str = ""
    body: str = ""

def meta_features_one(subject, body):
    subj_len = len(subject or "")
    body_len = len(body or "")
    url_count = len(URL_RE.findall(body or ""))
    has_html = int(bool(re.search(r'<\/?[a-z][\s\S]*>', body or "", re.I)))
    return np.array([[subj_len, body_len, url_count, has_html]])

_art = None
_emb = None

def load_models():
    global _art, _emb
    if _art is None:
        _art = joblib.load(MODEL_PATH)
        _emb = SentenceTransformer(_art['emb_model_name'])
    return _art, _emb

@app.on_event("startup")
def startup_load():
    try:
        load_models()
    except Exception as e:
        print("Model load failed at startup:", e)

@app.post("/predict")
def predict(r: Req):
    art, emb = load_models()
    text = (r.subject or "") + "\n\n" + (r.body or "")
    emb_v = emb.encode([text], convert_to_numpy=True)
    meta = meta_features_one(r.subject or "", r.body or "")
    X = np.hstack([emb_v, meta])
    spam_p = float(art['spam_clf'].predict_proba(X)[:,1][0])
    cat_probs = art['category_clf'].predict_proba(X)[0].tolist()
    top_idx = int(np.argmax(cat_probs))
    return {
        "spam_probability": spam_p,
        "categories": art['categories'],
        "category_probs": cat_probs,
        "predicted_category": art['categories'][top_idx]
    }
