-- v0.4.0 : 사진 중복 등록 방지, 버킷 용량·형식 제한
alter table ft_photos add constraint ft_photos_storage_path_key unique (storage_path);

update storage.buckets
set file_size_limit = 2097152,  -- 2MB (압축 후 1MB 이하라 여유 있게)
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'ft-photos';
