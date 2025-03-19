import streamlit as st

home_page = st.Page("views/home.py", title="Home", icon=":material/house:")
yt_page = st.Page("views/youtube.py", title="AI Music", icon=":material/play_arrow:")
substack_page = st.Page("views/substack.py", title="Recent Posts", icon=":material/rss_feed:")

pg = st.navigation([home_page, yt_page, substack_page])

pg.run()