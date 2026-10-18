import importlib.util
from pathlib import Path
import unittest

SPEC=importlib.util.spec_from_file_location('content_qc',Path(__file__).resolve().parents[1]/'scripts/content_qc.py')
qc=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(qc)

class ContentQCTest(unittest.TestCase):
    def test_good_video(self):
        obj={'aspect_ratio':'9:16','duration_seconds':8,'shots':[
            {'id':'s1','start_sec':0,'end_sec':3,'visual_prompt':'Opening'},
            {'id':'s2','start_sec':3,'end_sec':8,'visual_prompt':'Payoff'}]}
        self.assertEqual(qc.validate(obj,'video'),[])
    def test_gap(self):
        obj={'aspect_ratio':'9:16','duration_seconds':8,'shots':[
            {'id':'s1','start_sec':0,'end_sec':3,'visual_prompt':'Opening'},
            {'id':'s2','start_sec':4,'end_sec':8,'visual_prompt':'Payoff'}]}
        self.assertTrue(any('gap/overlap' in v for v in qc.validate(obj,'video')))
    def test_carousel_missing_slide(self):
        obj={'aspect_ratio':'9:16','slide_count':2,'slides':[{'number':1,'heading':'Hook','image_prompt':'A scene'}]}
        self.assertTrue(any('expected 2' in v for v in qc.validate(obj,'carousel')))
    def test_carousel_correct(self):
        obj={'aspect_ratio':'9:16','slide_count':2,'slides':[
            {'number':1,'heading':'Hook','body':'A','image_prompt':'Scene A'},
            {'number':2,'heading':'CTA','body':'B','image_prompt':'Scene B'}]}
        self.assertEqual(qc.validate(obj,'carousel'),[])
    def test_drama_requires_bible(self):
        obj={'aspect_ratio':'9:16','episodes':[{'number':1,'duration_seconds':1,
          'shots':[{'id':'s','start_sec':0,'end_sec':1,'visual_prompt':'Frame'}]}]}
        self.assertTrue(any('story_bible' in v for v in qc.validate(obj,'drama')))
    def test_prevent_nan(self):
        obj={'aspect_ratio':'9:16','duration_seconds':30,'shots':[{'id':'a','start_sec':0,'end_sec':float('nan'),'visual_prompt':'Something'}]}
        self.assertTrue(qc.validate(obj,'video'))

if __name__=='__main__':unittest.main()
